import * as fs from 'fs';

const failures = JSON.parse(fs.readFileSync(process.argv[2], 'utf-8'));

if (process.argv.length > 3) {
	const idxes = process.argv.slice(3).map(x => +x);
	failures.forEach(f => {
		if (idxes.indexOf(f.caseIdx) > -1) console.log(f);
	});
	process.exit(0);
}

const trackMinmaxHorse = ['speed', 'stamina', 'power', 'guts', 'wisdom'];
const trackSameHorse = ['strategy', 'strategyAptitude', 'distanceAptitude', 'surfaceAptitude'];
const trackSame = ['courseId', 'groundCondition', 'mood', 'paceEffectsEnabled'];
const trackExceptHorse = {
	strategy: ['Nige', 'Senkou', 'Sasi', 'Oikomi', 'Oonige'],
	strategyAptitude: ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'G'],
	distanceAptitude: ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'G'],
	surfaceAptitude: ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'G']
};
const trackExcept = {
	groundCondition: [0, 1, 2, 3],
	mood: [-2, -1, 0, 1, 2]
};

const initialState = {preSkillsSeen: Object.create(null), sutSkillsSeen: Object.create(null)};
trackMinmaxHorse.forEach(prop => {
	initialState['min$' + prop] = 10000;
	initialState['max$' + prop] = 0;
});
trackSameHorse.forEach(prop => {
	initialState['same$' + prop] = true;
	initialState['value$' + prop] = failures[0].params.horse[prop];
});
trackSame.forEach(prop => {
	initialState['same$' + prop] = true;
	initialState['value$' + prop] = failures[0].params[prop];
});
Object.keys(trackExceptHorse).forEach(prop => {
	initialState['except$' + prop] = Object.create(null);
	trackExceptHorse[prop].forEach(value => initialState['except$' + prop][value] = true);
});
Object.keys(trackExcept).forEach(prop => {
	initialState['except$' + prop] = Object.create(null);
	trackExcept[prop].forEach(value => initialState['except$' + prop][value] = true);
});

const results = failures.reduce((state,case_) => {
	trackMinmaxHorse.forEach(prop => {
		state['min$' + prop] = Math.min(state['min$' + prop], case_.params.horse[prop]);
		state['max$' + prop] = Math.max(state['max$' + prop], case_.params.horse[prop]);
	});
	trackSameHorse.forEach(prop => {
		state['same$' + prop] = state['same$' + prop] && (case_.params.horse[prop] == state['value$' + prop]);
		state['value$' + prop] = case_.params.horse[prop];
	});
	trackSame.forEach(prop => {
		state['same$' + prop] = state['same$' + prop] && (case_.params[prop] == state['value$' + prop]);
		state['value$' + prop] = case_.params[prop];
	});
	Object.keys(trackExceptHorse).forEach(prop => {
		state['except$' + prop][case_.params.horse[prop]] = false;
	});
	Object.keys(trackExcept).forEach(prop => {
		state['except$' + prop][case_.params[prop]] = false;
	});
	case_.params.presupposedSkills.forEach(sid => {
		if (sid in state.preSkillsSeen) {
			state.preSkillsSeen[sid] += 1;
		} else {
			state.preSkillsSeen[sid] = 1;
		}
	});
	case_.params.skillsUnderTest.forEach(sid => {
		if (sid in state.sutSkillsSeen) {
			state.sutSkillsSeen[sid] += 1;
		} else {
			state.sutSkillsSeen[sid] = 1;
		}
	});
	return state;
}, initialState);

function summarizeProps(props: any, except: any) {
	return props.map(prop => {
		if (results['same$' + prop]) {
			return prop + ' ' + results['value$' + prop];
		} else if (prop in except) {
			return prop + ' ' +
				Object.keys(results['except$' + prop])
					.filter(value => results['except$' + prop][value])
					.map(value => 'no ' + value)
					.join(' ');
		} else {
			return '';
		}
	}).join('\n');
}

function summarizeSkills(skills: any) {
	return Object.keys(skills)
		.map(sid => [sid,skills[sid]])
		.sort((a,b) => b[1] - a[1])
		.slice(0,5)
		.map(p => '\t' + p[0].toString().padStart(4) + '\t' + p[1])
		.join('\n');
}

console.log(failures.length + ' failures');
console.log(trackMinmaxHorse.map(prop => prop + ' ' + results['min$' + prop] + '~' + results['max$' + prop]).join('\n'));
console.log(summarizeProps(trackSameHorse, trackExceptHorse));
console.log(summarizeProps(trackSame, trackExcept));
console.log('pre');
console.log(summarizeSkills(results.preSkillsSeen));
console.log('sut');
console.log(summarizeSkills(results.sutSkillsSeen));
