import * as fc from 'fast-check';
import { prop, forAll } from './TestHelpers';

import { CourseHelpers } from '../CourseData';

prop('array with strictly increasing elements is sorted', forAll(fc.array(fc.nat(9999)), xs => {
	let acc = -1;
	const a = xs.map(x => ({start: acc += x + 1}));
	return CourseHelpers.isSortedByStart(a);
}));

// limit to 9999 because
//     >> [ 164202479, 999999999  ].sort()
//        Array [ 164202479, 999999999 ]
//     >> [ 164202479, 1000000000 ].sort()
//        Array [ 1000000000, 164202479 ]
// idk

prop('array with not strictly increasing elements is not sorted', forAll(fc.array(fc.nat(9999), {minLength: 2}), xs => {
	xs.sort();
	const sorted = xs.slice();
	while (xs.every((x,i) => x === sorted[i])) {
		for (let i = xs.length; --i >= 0;) {
			const j = Math.floor(Math.random() * (i + 1));
			[xs[i],xs[j]] = [xs[j],xs[i]];
		}
	}
	return !CourseHelpers.isSortedByStart(xs.map(x => ({start: x})));
}));
