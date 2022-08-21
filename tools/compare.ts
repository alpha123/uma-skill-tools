import * as fs from 'fs';
import { program, Option } from 'commander';
import { SkillData, buildSkillData, buildHorseParameters } from './ToolCLI';
import { CourseHelpers } from '../CourseData';
import { Region, RegionList } from '../Region';
import { Rule30CARng } from '../Random';
import { RaceSolver } from '../RaceSolver';

// this shares considerable overlap with gain.ts but it's not too clear what a nice way to share code between them would be
// either way it's (currently) only two like this, i'm not sure it's worth abstracting anything into a framework sufficiently
// generic to handle both gain.ts and this
// just copy paste some things :)

program
	.argument('<horsefile1>', 'path to a JSON file describing the first horse\'s parameters')
	.argument('<horsefile2>', 'path to a JSON file describing the second horse\'s parameters')
	.requiredOption('-c, --course <id>', 'course ID')
	.addOption(new Option('-m, --mood <mood>', 'the uma\'s mood')
		.choices(['-2', '-1', '0', '+1', '+2'])
		.default(+2)
		.argParser(x => parseInt(x,10))  // can't just use .argParser(parseInt) because it also gets passed the default value
	)
	.addOption(new Option('-g, --ground <condition>', 'track condition').choices(['good', 'yielding', 'soft', 'heavy']).default('good'))
	.addOption(new Option('-N, --nsamples <N>', 'number of random samples to use for skills with random conditions')
		.default(500)
		.argParser(x => parseInt(x,10))
	)
	.option('--seed <seed>', 'seed value for pseudorandom number generator', (value,_) => parseInt(value,10) >>> 0)
	.addOption(new Option('--thresholds <cutoffs>', 'comma-separated list of values; print the percentage of the time they are exceeded')
		.default([0.5,1.0,1.5,2.0,2.5])
		.argParser(t => t.split(',').map(parseFloat))
	)
	.option('--dump', 'instead of printing a summary, dump data. intended to be piped into histogram.py.');

program.parse();
const opts = program.opts();

const course = CourseHelpers.getCourse(opts.course);

const desc1 = JSON.parse(fs.readFileSync(program.args[0], 'utf8'));
const horse1 = buildHorseParameters(desc1, course, opts.mood, opts.ground);

const desc2 = JSON.parse(fs.readFileSync(program.args[1], 'utf8'));
const horse2 = buildHorseParameters(desc2, course, opts.mood, opts.ground);

const wholeCourse = new RegionList();
wholeCourse.push(new Region(0, course.distance));
Object.freeze(wholeCourse);

const skills1 = desc1.skills.map(s => buildSkillData(horse1, course, wholeCourse, s)).filter(s => s != null);
const skills2 = desc2.skills.map(s => buildSkillData(horse2, course, wholeCourse, s)).filter(s => s != null);

const seed = 'seed' in opts ? opts.seed : Math.floor(Math.random() * (-1 >>> 0));
// use two rng instances so that if the skills are the same (or different versions of each other, e.g. comparing inherited vs full
// uniques) they'll activate at the same points
// TODO to be sure of this, we need to sort skills1 and skills2 such that skills common between them are ordered first
const rng1 = new Rule30CARng(seed);
const rng2 = new Rule30CARng(seed);

const triggers1 = skills1.map(sd => sd.samplePolicy.sample(sd.regions, opts.nsamples, rng1));
const triggers2 = skills2.map(sd => sd.samplePolicy.sample(sd.regions, opts.nsamples, rng2));

function addSkill(s: RaceSolver, sd: SkillData, triggers: Region[], i: number) {
	s.pendingSkills.push({
		skillId: sd.skillId,
		rarity: sd.rarity,
		trigger: triggers[i % triggers.length],
		extraCondition: sd.extraCondition,
		effects: sd.effects
	});
}

// can't reuse rng1/rng2 for the solver rngs since they have sampled different skills
const solverRngSeed = rng1.int32();
const solverRng1 = new Rule30CARng(solverRngSeed);
const solverRng2 = new Rule30CARng(solverRngSeed);

const gain = [];
for (let i = 0; i < opts.nsamples; ++i) {
	const s = new RaceSolver({horse: horse1, course, rng: solverRng1});
	skills1.forEach((sd,sdi) => addSkill(s, sd, triggers1[sdi], i));

	while (s.pos < course.distance) {
		s.step(1/60);
	}

	const s2 = new RaceSolver({horse: horse2, course, rng: solverRng2});
	skills2.forEach((sd,sdi) => addSkill(s2, sd, triggers2[sdi], i));
	// NB. if horse2 is faster then this ends up going past the course distance
	// this is not in itself a problem, but it would overestimate the difference if for example a skill continues past the end of the
	// course. i feel like there are probably some other situations where it would be inaccurate also. the right thing to do is also
	// bound the loop by s2.pos < course.distance and if s2 finishes before s, rerun s with s.accumulatetime < s2.accumulatetime and
	// then compute the difference between them. that is mildly annoying though so i haven't done it yet.
	// TODO see above
	while (s2.accumulatetime < s.accumulatetime) {
		s2.step(1/60);
	}
	gain.push((s.pos - s2.pos) / 2.5);
}
gain.sort((a,b) => a - b);

if (opts.dump) {
	console.log(JSON.stringify(gain));
	require('process').exit(0);
}

console.log('min:\t' + gain[0].toFixed(2));
console.log('max:\t' + gain[gain.length-1].toFixed(2));
const mid = Math.floor(gain.length / 2);
console.log('median:\t' + (gain.length % 2 == 0 ? (gain[mid-1] + gain[mid]) / 2 : gain[mid]).toFixed(2));
console.log('mean:\t' + (gain.reduce((a,b) => a + b) / gain.length).toFixed(2));

if (opts.thresholds.length > 0) {
	console.log('');
}
opts.thresholds.forEach(n => {
    console.log('≥' + n.toFixed(2) + ' | ' + (gain.reduce((a,b) => a + +(b >= n), 0) / gain.length * 100).toFixed(2) + '%');
});

console.log('');
console.log('seed: ' + (seed >>> 0));
