import { Option } from 'commander';
import { HorseParameters } from '../HorseTypes';
import { CourseData } from '../CourseData';
import { Region } from '../Region';
import { PendingSkill, RaceSolver } from '../RaceSolver';
import { SkillData, ToolCLI, parseAptitude } from './ToolCLI';

const cli = new ToolCLI();
cli.options((program) => {
	program
		.addOption(new Option('-N, --nsamples <N>', 'number of random samples to use for skills with random conditions')
			.default(500)
			.argParser(x => parseInt(x,10))
		)
		.addOption(new Option('-D, --distance-aptitude <letter>', 'compare with a different distance aptitude from the value in the horse definition')
			.choices(['S', 'A', 'B', 'C', 'D', 'E', 'F', 'G'])
			.argParser(a => parseAptitude(a, 'distance'))
		)
		.addOption(new Option('-S, --surface-aptitude <letter>', 'compare with a different surface aptitude from the value in the horse definition')
			.choices(['S', 'A', 'B', 'C', 'D', 'E', 'F', 'G'])
			.argParser(a => parseAptitude(a, 'surface'))
		)
		.addOption(new Option('--thresholds <cutoffs>', 'comma-separated list of values; print the percentage of the time they are exceeded')
			.default([0.5,1.0,1.5,2.0,2.5])
			.argParser(t => t.split(',').map(parseFloat))
		)
		.option('--dump', 'instead of printing a summary, dump data. intended to be piped into histogram.py.');
});
cli.run((horse: HorseParameters, course: CourseData, defSkills: SkillData[], cliSkills: SkillData[], cliOptions: any) => {
	const nsamples = cliOptions.nsamples;
	const triggers = [];
	function addTriggers(sd: SkillData) {
		triggers.push(sd.samplePolicy.sample(sd.regions, nsamples));
	}

	const debuffs = [];
	for (let i = cliSkills.length; --i >= 0;) {
		const ef = cliSkills[i].effects;
		if (ef.some(e => e.modifier < 0)) {
			const debuffEffects = [];
			debuffs.push(Object.assign({}, cliSkills[i], {effects: debuffEffects}));
			for (let j = ef.length; --j >= 0;) {
				if (ef[j].modifier < 0) {
					debuffEffects.push(ef[j]);
					ef.splice(j,1);
				}
			}
			if (ef.length == 0) {
				cliSkills.splice(i,1);
			}
		}
	}

	defSkills.forEach(addTriggers);
	cliSkills.forEach(addTriggers);
	debuffs.forEach(addTriggers);

	function addSkill(s: RaceSolver, sd: SkillData, triggers: Region[], i: number) {
		s.pendingSkills.push({
			skillId: sd.skillId,
			rarity: sd.rarity,
			trigger: triggers[i % triggers.length],
			extraCondition: sd.extraCondition,
			effects: sd.effects
		});
	}

	let testHorse = horse;
	if (cliOptions.distanceAptitude != undefined) {
		testHorse = Object.freeze(Object.assign({}, testHorse, {distanceAptitude: cliOptions.distanceAptitude}));
	}
	if (cliOptions.surfaceAptitude != undefined) {
		testHorse = Object.freeze(Object.assign({}, testHorse, {surfaceAptitude: cliOptions.surfaceAptitude}));
	}

	const gain = [];
	for (let i = 0; i < nsamples; ++i) {
		const s = new RaceSolver(testHorse, course);
		defSkills.forEach((sd,sdi) => addSkill(s, sd, triggers[sdi], i));
		cliSkills.forEach((sd,sdi) => addSkill(s, sd, triggers[sdi + defSkills.length], i));

		while (s.pos < course.distance) {
			s.step(1/60);
		}

		const s2 = new RaceSolver(horse, course);
		defSkills.forEach((sd,sdi) => addSkill(s2, sd, triggers[sdi], i));
		debuffs.forEach((sd,sdi) => addSkill(s2, sd, triggers[sdi + defSkills.length + cliSkills.length], i));
		while (s2.accumulatetime < s.accumulatetime) {
			s2.step(1/60);
		}
		gain.push((s.pos - s2.pos) / 2.5);
	}
	gain.sort((a,b) => a - b);

	if (cliOptions.dump) {
		console.log(JSON.stringify(gain));
		return;
	}

	console.log('min:\t' + gain[0].toFixed(2));
	console.log('max:\t' + gain[gain.length-1].toFixed(2));
	const mid = Math.floor(gain.length / 2);
	console.log('median:\t' + (gain.length % 2 == 0 ? (gain[mid-1] + gain[mid]) / 2 : gain[mid]).toFixed(2));
	console.log('mean:\t' + (gain.reduce((a,b) => a + b) / gain.length).toFixed(2));

	if (cliOptions.thresholds.length > 0) {
		console.log('');
	}
	cliOptions.thresholds.forEach(n => {
	    console.log('≥' + n.toFixed(2) + ' | ' + (gain.reduce((a,b) => a + +(b >= n), 0) / gain.length * 100).toFixed(2) + '%');
	});
});
