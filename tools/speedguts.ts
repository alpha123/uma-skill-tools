import * as fs from 'fs';
import { program, Option } from 'commander';
import { buildSkillData, buildHorseParameters } from './ToolCLI';
import { CourseHelpers } from '../CourseData';
import { Region, RegionList } from '../Region';
import { Rule30CARng } from '../Random';
import { RaceSolver } from '../RaceSolver';

program
	.argument('<horsefile>', 'path to a JSON file describing the horse\'s parameters')
	.requiredOption('-c, --course <id>', 'course ID')
	.addOption(new Option('-m, --mood <mood>', 'the uma\'s mood')
		.choices(['-2', '-1', '0', '+1', '+2'])
		.default(2, '+2')
		.argParser(x => parseInt(x,10))  // can't just use .argParser(parseInt) because it also gets passed the default value
	)
	.addOption(new Option('-g, --ground <condition>', 'track condition').choices(['good', 'yielding', 'soft', 'heavy']).default('good', 'good'))
	.addOption(new Option('--speed-range <range>', 'closed interval start,end of speed stats to test')
		.default([400,2000], '400,2000')
		.argParser(s => s.split(',').map(x => parseInt(x,10)))
	)
	.addOption(new Option('--guts-range <range>', 'closed interval start,end of guts stats to test')
		.default([400,2000], '400,2000')
		.argParser(s => s.split(',').map(x => parseInt(x,10)))
	)
	.option('--step <number>', 'increments of speed and guts to test', x => parseInt(x,10), 50)
	.addOption(new Option('--standard <speed,guts>', 'speed,guts pair to compare with')
		.default([1200,600], '1200,600')
		.argParser(s => s.split(',').map(x => parseInt(x,10)))
	);

program.parse();
const opts = program.opts();

const seed = 1;
const dt = 1/60;

const course = CourseHelpers.getCourse(opts.course);
const desc = JSON.parse(fs.readFileSync(program.args[0], 'utf8'));

const wholeCourse = new RegionList();
wholeCourse.push(new Region(0, course.distance));
Object.freeze(wholeCourse);

function buildSolver(speed: number, guts: number) {
	const adjustedSpeed = speed > 1200 ? 1200 + (speed - 1200) / 2 : speed;
	const adjustedGuts = guts > 1200 ? 1200 + (guts - 1200) / 2 : guts;

	const rng = new Rule30CARng(seed);
	const horse = buildHorseParameters(Object.assign(desc, {speed: adjustedSpeed, guts: adjustedGuts}), course, opts.mood, opts.ground);
	const skills = desc.skills.map(s => buildSkillData(horse, course, wholeCourse, s)).filter(s => s != null).map(sd => {
		return {
			skillId: sd.skillId,
			rarity: sd.rarity,
			trigger: sd.samplePolicy.sample(sd.regions, 1, rng)[0],
			extraCondition: sd.extraCondition,
			effects: sd.effects
		};
	});

	return new RaceSolver({horse, course, skills, rng});
}

const min = buildSolver(opts.speedRange[0], opts.gutsRange[0]);
while (min.pos < course.distance) {
	min.step(dt);
}

const standard = {};
const base = buildSolver(opts.standard[0], opts.standard[1]);
// intentionally run past the end of the course (potentially far past) to have position at accumulatetime values for slower instances
// this is generally actually fine unless the horse has skills that would extend their duration past the end of the course, in which
// case it overestimates
// but those probably won't be used for just raw speed/guts comparisons
while (base.accumulatetime <= min.accumulatetime) {
	standard[base.accumulatetime] = base.pos;
	base.step(dt);
}

const gain = [];
for (let guts = opts.gutsRange[0]; guts <= opts.gutsRange[1]; guts += opts.step) {
	const row = [];
	gain.push(row);
	for (let speed = opts.speedRange[0]; speed <= opts.speedRange[1]; speed += opts.step) {
		const s = buildSolver(speed, guts);
		while (s.pos < course.distance) {
			s.step(dt);
		}
		row.push((s.pos - standard[s.accumulatetime]) / 2.5);
	}
}

console.log(JSON.stringify({
	speed: {start: opts.speedRange[0], end: opts.speedRange[1], step: opts.step},
	guts: {start: opts.gutsRange[0], end: opts.gutsRange[1], step: opts.step},
	standard: {speed: opts.standard[0], guts: opts.standard[1]},
	gain: gain
}));
