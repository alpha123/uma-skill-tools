const assert = require('assert').strict;

export type Phase = 0 | 1 | 2 | 3;
export const enum Surface { Turf, Dirt }
export const enum DistanceType { Short = 1, Mile, Mid, Long }
export const enum Orientation { Clockwise = 1, Counterclockwise }

export interface CourseData {
	distance: number
	distanceType: DistanceType
	surface: Surface
	turn: Orientation
	corners: {start: number, length: number}[]
	straights: {start: number, end: number}[]
	slopes: {start: number, length: number, slope: number}[]
}

export namespace CourseHelpers {
	export function assertIsPhase(phase: number): asserts phase is Phase {
		assert(phase == 0 || phase == 1 || phase == 2 || phase == 3);
	}

	export function assertIsDistanceType(distanceType: number): asserts distanceType is DistanceType {
		assert(
		   distanceType == DistanceType.Short
		|| distanceType == DistanceType.Mile
		|| distanceType == DistanceType.Mid
		|| distanceType == DistanceType.Long);
	}

	export function assertIsOrientation(orientation: number): asserts orientation is Orientation {
		assert(orientation == Orientation.Clockwise || orientation == Orientation.Counterclockwise);
	}

	export function isSortedByStart(arr: {start: number}[]) {
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
}
