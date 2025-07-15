import * as fc from 'fast-check';

import * as rparams from '../../RaceParameters';
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

export function Mood() {
	return fc.constantFrom<rparams.Mood>(-2, -1, 0, 1, 2).noBias();
}

export function GroundCondition() {
	return fc.constantFrom(rparams.GroundCondition.Good, rparams.GroundCondition.Yielding, rparams.GroundCondition.Soft, rparams.GroundCondition.Heavy)
	         .noBias();
}

export function Weather() {
	return fc.constantFrom(rparams.Weather.Sunny, rparams.Weather.Cloudy, rparams.Weather.Rainy, rparams.Weather.Snowy).noBias();
}

export function Season() {
	return fc.constantFrom(rparams.Season.Spring, rparams.Season.Summer, rparams.Season.Autumn, rparams.Season.Winter, rparams.Season.Sakura)
	         .noBias();
}

export function Time() {
	return fc.constantFrom(rparams.Time.Morning, rparams.Time.Midday, rparams.Time.Evening, rparams.Time.Night).noBias();
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
	horse: build.HorseDesc
	courseId: string
	mood: rparams.Mood
	groundCondition: rparams.GroundCondition
	weather?: rparams.Weather  // these are all marked optional because they didn't used to exist and we want to be able to
	season?: rparams.Season    // run old checkpoints, so we can't assume they're there
	time?: rparams.Time
	orderInfo?: {
		orderRange?: [number,number]
		numUmas: number
		popularity: number
	}
	paceEffectsEnabled: boolean
	nsamples: number
	presupposedSkills: string[]
	skillsUnderTest: string[]
}

export function Race({maxSamples = 200, maxPreSkills = 30, maxSut = 30}: {maxSamples?: number, maxPreSkills?: number, maxSut?: number} = {}) {
	return fc.record({
		seed: fc.integer().noBias().noShrink(),
		horse: HorseDesc(),
		courseId: CourseId(),
		mood: Mood(),
		groundCondition: GroundCondition(),
		weather: Weather(),
		season: Season(),
		time: Time(),
		orderInfo: fc.tuple(
			fc.boolean(),  // has order range info
			fc.integer({min: 1, max: 18}),  // order range start
			fc.integer({min: 0, max: 18}),  // order range length
			fc.integer({min: 0, max: 18}),  // # umas after order range end (start + length + extra == numUmas)
			fc.double({min: 0.0, max: 0.99, noNaN: true})  // % of numUmas more popular than us
		).map(([hasOrder,start,length,extra,pop]) => ({
			numUmas: start + length + extra,
			orderRange: hasOrder ? [start, start + length] as [number,number] : void 0,
			popularity: Math.floor((start + length + extra) * pop) + 1
		})),
		paceEffectsEnabled: fc.boolean(),
		nsamples: fc.integer({min: 1, max: maxSamples}),
		presupposedSkills: SkillList(maxPreSkills),
		skillsUnderTest: SkillList(maxSut)
	});
}

export function makeBuilder(params: RaceParams) {
	const builder = new build.RaceSolverBuilder(params.nsamples)
		.seed(params.seed)
		.horse(params.horse)
		.course(+params.courseId)
		.mood(params.mood)
		.ground(params.groundCondition);
	if (params.weather != null) builder.weather(params.weather);
	if (params.season != null) builder.season(params.season);
	if (params.time != null) builder.time(params.time);
	if (params.orderInfo != null) {
		builder.numUmas(params.orderInfo.numUmas).popularity(params.orderInfo.popularity);
		if (params.orderInfo.orderRange != null) {
			builder.order(params.orderInfo.orderRange[0], params.orderInfo.orderRange[1]);
		}
	}
	if (params.paceEffectsEnabled) {
		builder.useDefaultPacer();
	}
	builder.withAsiwotameru().withStaminaSyoubu();
	params.presupposedSkills.forEach(id => builder.addSkill(id));
	return builder;
}
