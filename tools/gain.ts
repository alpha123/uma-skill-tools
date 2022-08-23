import { Option } from 'commander';
import { HorseParameters } from '../HorseTypes';
import { CourseData } from '../CourseData';
import { Region } from '../Region';
import { Rule30CARng } from '../Random';
import { PendingSkill, RaceSolver } from '../RaceSolver';
import { SkillData, ToolCLI, PacerProvider, parseAptitude } from './ToolCLI';

const cli = new ToolCLI();
cli.options(program => {
	program
		.addOption(new Option('-N, --nsamples <N>', 'number of random samples to use for skills with random conditions')
			.default(500)
			.argParser(x => parseInt(x,10))
		)
		.option('--seed <seed>', 'seed value for pseudorandom number generator', (value,_) => parseInt(value,10) >>> 0)
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
cli.run((horse: HorseParameters, course: CourseData, defSkills: SkillData[], cliSkills: SkillData[], getPacer: PacerProvider, cliOptions: any) => {
	const nsamples = cliOptions.nsamples;
	const triggers = [];
	const seed = ('seed' in cliOptions ? cliOptions.seed : Math.floor(Math.random() * (-1 >>> 0))) >>> 0;
	const rng = new Rule30CARng(seed);
	// need two copies of an identical rng so that random factors will be deterministic between both solver instances
	const solverRngSeed = rng.int32();
	const solverRng1 = new Rule30CARng(solverRngSeed);
	const solverRng2 = new Rule30CARng(solverRngSeed);
	const pacerRngSeed = rng.int32();
	const pacerRng1 = new Rule30CARng(pacerRngSeed);
	const pacerRng2 = new Rule30CARng(pacerRngSeed);

	function addTriggers(sd: SkillData) {
		triggers.push(sd.samplePolicy.sample(sd.regions, nsamples, rng));
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

	function addSkill(skills: PendingSkill[], sd: SkillData, triggers: Region[], i: number) {
		skills.push({
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

	// NB. if --distance-aptitude or --surface-aptitude are specified the pacer will still have the default aptitudes even when pacing the
	// modified aptitude version.
	// i'm not really sure if that's the expected thing to do or not, but it makes sense (imo)

	const gain = [];
	let min = Infinity, max = 0, mini = 0, maxi = 0;
	for (let i = 0; i < nsamples; ++i) {
		const skills1 = [];
		defSkills.forEach((sd,sdi) => addSkill(skills1, sd, triggers[sdi], i));
		cliSkills.forEach((sd,sdi) => addSkill(skills1, sd, triggers[sdi + defSkills.length], i));
		const s = new RaceSolver({horse: testHorse, course, skills: skills1, pacer: getPacer(pacerRng1), rng: solverRng1});

		while (s.pos < course.distance) {
			s.step(1/60);
		}

		const skills2 = [];
		defSkills.forEach((sd,sdi) => addSkill(skills2, sd, triggers[sdi], i));
		debuffs.forEach((sd,sdi) => addSkill(skills2, sd, triggers[sdi + defSkills.length + cliSkills.length], i));
		const s2 = new RaceSolver({horse, course, skills: skills2, pacer: getPacer(pacerRng2), rng: solverRng2});
		while (s2.accumulatetime < s.accumulatetime) {
			s2.step(1/60);
		}
		const diff = (s.pos - s2.pos) / 2.5;
		gain.push(diff);
		if (diff < min) {
			min = diff;
			mini = i;
		}
		if (diff > max) {
			max = diff;
			maxi = i;
		}
	}
	gain.sort((a,b) => a - b);

	if (cliOptions.dump) {
		console.log(JSON.stringify(gain));
		return;
	}

	console.log('min:\t' + min.toFixed(2));
	console.log('max:\t' + max.toFixed(2));
	const mid = Math.floor(gain.length / 2);
	console.log('median:\t' + (gain.length % 2 == 0 ? (gain[mid-1] + gain[mid]) / 2 : gain[mid]).toFixed(2));
	console.log('mean:\t' + (gain.reduce((a,b) => a + b) / gain.length).toFixed(2));

	if (cliOptions.thresholds.length > 0) {
		console.log('');
	}
	cliOptions.thresholds.forEach(n => {
	    console.log('≥' + n.toFixed(2) + ' | ' + (gain.reduce((a,b) => a + +(b >= n), 0) / gain.length * 100).toFixed(2) + '%');
	});

	console.log('');
	console.log('seed: ' + seed);

	console.log('');

	const conf = Buffer.alloc(12);
	const conf32 = new Int32Array(conf.buffer);
	conf32[0] = seed;
	conf32[1] = nsamples;
	conf32[2] = mini;
	console.log('min configuration: ' + conf.toString('base64'))
	conf32[2] = maxi;
	console.log('max configuration: ' + conf.toString('base64'));
});
