const assert = require('assert').strict;

export type Phase = 0 | 1 | 2 | 3;
export const enum Surface { Turf = 1, Dirt }
export const enum DistanceType { Short = 1, Mile, Mid, Long }
export const enum Orientation { Clockwise = 1, Counterclockwise }
export const enum ThresholdStat { Speed = 1, Stamina, Power, Guts, Int }

export interface CourseData {
	readonly raceTrackId: number
	readonly distance: number
	readonly distanceType: DistanceType
	readonly surface: Surface
	readonly turn: Orientation
	readonly courseSetStatus: readonly ThresholdStat[]
	readonly corners: readonly {readonly start: number, readonly length: number}[]
	readonly straights: readonly {readonly start: number, readonly end: number}[]
	readonly slopes: readonly {readonly start: number, readonly length: number, readonly slope: number}[]
}

import courses from './data/course_data.json';

export namespace CourseHelpers {
	export function assertIsPhase(phase: number): asserts phase is Phase {
		assert(phase == 0 || phase == 1 || phase == 2 || phase == 3);
	}

	export function assertIsSurface(surface: number): asserts surface is Surface {
		assert(Surface.hasOwnProperty(surface));
	}

	export function assertIsDistanceType(distanceType: number): asserts distanceType is DistanceType {
		assert(DistanceType.hasOwnProperty(distanceType));
	}

	export function assertIsOrientation(orientation: number): asserts orientation is Orientation {
		assert(Orientation.hasOwnProperty(orientation));
	}

	export function isSortedByStart(arr: readonly {readonly start: number}[]) {
		// typescript seems to have some trouble inferring tuple types, presumably because it doesn't really
		// sufficiently distinguish tuples from arrays
		// so dance around a little bit to make it work
		const init: [boolean, number] = [true, -1];
		function isSorted(a: [boolean, number], b: {start: number}): [boolean,number] {
			return [a[0] && b.start > a[1], b.start];
		}
		return arr.reduce(isSorted, init)[0];
	}

	export function phaseStart(distance: number, phase: Phase) {
		switch (phase) {
		case 0: return 0;
		case 1: return distance * 1/6;
		case 2: return distance * 2/3;
		case 3: return distance * 5/6;
		}
	}

	export function phaseEnd(distance: number, phase: Phase) {
		switch (phase) {
		case 0: return distance * 1/6;
		case 1: return distance * 2/3;
		case 2: return distance * 5/6;
		case 3: return distance;
		}
	}

	export function courseSpeedModifier(
		course: CourseData,
		stats: Readonly<{speed: number, stamina: number, power: number, guts: number, wisdom: number}>
	) {
		const statvalues = [0, stats.speed, stats.stamina, stats.power, stats.guts, stats.wisdom].map(x => Math.min(x, 901));
		return 1 + course.courseSetStatus.map(
			stat => (1 + Math.floor(statvalues[stat] / 300.01)) * 0.05
		).reduce((a,b) => a + b, 0) / Math.max(course.courseSetStatus.length,1);
	}

	export function getCourse(courseId: number): CourseData {
		const course = courses[courseId];
		course.slopes.sort((a,b) => a.start - b.start);
		Object.keys(course).forEach(k => Object.freeze(course[k]));
		return Object.freeze(course);
	}
}
