import * as fc from 'fast-check';

import * as build from '../../RaceSolverBuilder';

import courses from '../../data/course_data.json';
import skills from '../../data/skill_data.json';

const courseids = Object.freeze(Object.keys(courses));
const skillids = Object.freeze(Object.keys(skills).filter(id => {
	// filter out skill ids that will throw on construction due to unimplemented activation conditions
	const b = new build.RaceSolverBuilder(1).course(10101).horse({
		speed: 1000,
		stamina: 1000,
		power: 1000,
		guts: 1000,
		wisdom: 1000,
		strategy: 'Nige',
		distanceAptitude: 'A',
		surfaceAptitude: 'A',
		strategyAptitude: 'A'
	}).addSkill(id);
	try {
		const g = b.build();
		g.next();
		return true;
	} catch (_) {
		return false;
	}
}));

export function CourseId() {
	return fc.constantFrom(...courseids).noBias().noShrink();
}

export function GroundCondition() {
	return fc.constantFrom(build.GroundCondition.Good, build.GroundCondition.Yielding, build.GroundCondition.Soft, build.GroundCondition.Heavy)
	         .noBias();
}

export function Mood() {
	return fc.constantFrom<build.Mood>(-2, -1, 0, 1, 2).noBias();
}

export function Stat() {
	return fc.integer({min: 1, max: 2000});
}

export function Strategy() {
	return fc.constantFrom('Nige', 'Senkou', 'Sasi', 'Oikomi', 'Oonige').noBias();
}

export function Aptitude() {
	return fc.constantFrom('S', 'A', 'B', 'C', 'D', 'E', 'F', 'G').noBias();
}

export function HorseDesc() {
	return fc.record({
		speed: Stat(),
		stamina: Stat(),
		power: Stat(),
		guts: Stat(),
		wisdom: Stat(),
		strategy: Strategy(),
		distanceAptitude: Aptitude(),
		surfaceAptitude: Aptitude(),
		strategyAptitude: Aptitude()
	});
}

export function SkillList(max: number = 30) {
	return fc.array(fc.constantFrom(...skillids).noBias(), {maxLength: max});
}

export interface RaceParams {
	seed: number
	courseId: string
	groundCondition: build.GroundCondition
	mood: build.Mood
	horse: build.HorseDesc
	paceEffectsEnabled: boolean
	nsamples: number
	presupposedSkills: string[]
	skillsUnderTest: string[]
}

export function Race({maxSamples = 200, maxPreSkills = 30, maxSut = 30}: {maxSamples?: number, maxPreSkills?: number, maxSut?: number} = {}) {
	return fc.record({
		seed: fc.integer().noBias().noShrink(),
		courseId: CourseId(),
		groundCondition: GroundCondition(),
		mood: Mood(),
		horse: HorseDesc(),
		paceEffectsEnabled: fc.boolean(),
		nsamples: fc.integer({min: 1, max: maxSamples}),
		presupposedSkills: SkillList(maxPreSkills),
		skillsUnderTest: SkillList(maxSut)
	});
}

export function makeBuilder(params: RaceParams) {
	const builder = new build.RaceSolverBuilder(params.nsamples)
		.seed(params.seed)
		.course(+params.courseId)
		.ground(params.groundCondition)
		.mood(params.mood)
		.horse(params.horse);
	if (params.paceEffectsEnabled) {
		builder.useDefaultPacer();
	}
	builder.withAsiwotameru();
	params.presupposedSkills.forEach(id => builder.addSkill(id));
	return builder;
}
