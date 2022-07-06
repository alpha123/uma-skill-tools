export type Phase = 0 | 1 | 2 | 3;
export const enum Surface { Turf, Dirt }
export const enum DistanceType { Short = 1, Mile, Mid, Long }

export interface CourseData {
	distance: number
	distanceType: DistanceType
	surface: Surface
	corners: {start: number, length: number}[]
	straights: {start: number, end: number}[]
	slopes: {start: number, length: number, slope: number}[]

	//isUphill(m: number): boolean
	//slopePer(m: number): number
}

export namespace CourseHelpers {
	export function assertIsPhase(phase: number): asserts phase is Phase {
		if (!(phase == 0 || phase == 1 || phase == 2 || phase == 3)) throw new Error('bad phase');
	}

	export function assertIsDistanceType(distanceType: number): asserts distanceType is DistanceType {
		if (!(
		   distanceType == DistanceType.Short
		|| distanceType == DistanceType.Mile
		|| distanceType == DistanceType.Mid
		|| distanceType == DistanceType.Long)) {
			throw new Error('bad distance type');
		}
	}

	export function isSortedByStart(arr: {start: number}[]) {
		// typescript seems to have some trouble inferring tuple types, presumably because it doesn't really
		// sufficiently distinguish tuples from arrays
		// so dance around a little bit to make it work
		const init: [boolean, number] = [true, arr.length > 0 ? arr[0].start : 0];
		function isSorted(a: [boolean, number], b: {start: number}): [boolean,number] {
			return [a[0] && b.start > a[1], b.start];
		}
		return arr.slice(1).reduce(isSorted, init)[0];
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
