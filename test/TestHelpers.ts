import test from 'tape';
import * as fc from 'fast-check';

export function prop(msg: string, f: () => void) {
	test(msg, t => {
		t.plan(1);
		t.doesNotThrow(f);
	});
}

export function forAll<Ts extends [unknown, ...unknown[]]>(
	...args: [...arbs: { [K in keyof Ts]: fc.Arbitrary<Ts[K]> }, pred: (...args: Ts) => boolean | void]
) {
	return () => fc.assert(fc.property(...args));
}
