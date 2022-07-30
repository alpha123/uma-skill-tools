import { Option } from 'commander';
import { HorseParameters } from '../HorseTypes';
import { CourseData } from '../CourseData';
import { Region } from '../ActivationConditions';
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
		);
});
cli.run((horse: HorseParameters, course: CourseData, defSkills: SkillData[], cliSkills: SkillData[], cliOptions: any) => {
	const nsamples = cliOptions.nsamples;
	const triggers = [];
	function addTriggers(sd: SkillData) {
		triggers.push(sd.samplePolicy.sample(sd.regions, nsamples));
	}
	defSkills.forEach(addTriggers);
	cliSkills.forEach(addTriggers);

	function addSkill(s: RaceSolver, sd: SkillData, triggers: Region[], i: number) {
		sd.effects.forEach(ef => {
			s.pendingSkills.push({trigger: triggers[i % triggers.length], extraCondition: sd.extraCondition, effect: ef});
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
		while (s2.accumulatetime < s.accumulatetime) {
			s2.step(1/60);
		}
		gain.push((s.pos - s2.pos) / 2.5);
	}

	gain.sort((a,b) => a - b);
	console.log('min:\t' + gain[0].toFixed(2));
	console.log('max:\t' + gain[gain.length-1].toFixed(2));
	const mid = Math.floor(gain.length / 2);
	console.log('median:\t' + (gain.length % 2 == 0 ? (gain[mid-1] + gain[mid]) / 2 : gain[mid]).toFixed(2));
	console.log('mean:\t' + (gain.reduce((a,b) => a + b) / gain.length).toFixed(2));

	if (cliOptions.thresholds.length > 0) {
		console.log('');
	}
	cliOptions.thresholds.forEach(n => {
	    console.log('≥' + n.toFixed(1) + ' | ' + (gain.reduce((a,b) => a + +(b >= n), 0) / gain.length * 100).toFixed(1) + '%');
	});
});
