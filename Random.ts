export interface PRNG {
	int32(): number
	random(): number
	uniform(upper: number): number
}

// random number generator based on cellular automata
// uses the chaotic nature of Wolfram rule 30 to generate random numbers[0]
// technically, you're not supposed to use multiple bits of each generation like this (uses four bits from each generation but generates
// two integers in parallel)
// however we don't actually need extremely robust randomness, we need something with a simple implementation and runs fast
// in practice as far as i can tell the randomness is actually extremely good; it is completely incompressible and passes PractRand[1]
// at least up to 16mb (at which point node runs out of memory for reasons i do not understand but are slightly concerning, since i think
// this should use a constant amount of memory)
// PractRand eventually ends up finding one suspicious DC6 test; this is eliminated by using only a single bit from each generation.
// faster than some random PCG implementation i found on github[2] and much simpler
//
// [0] https://legacy.cs.indiana.edu/~dgerman/2005midwestNKSconference/dgelbm.pdf
// [1] http://pracrand.sourceforge.net/
// [2] https://github.com/thomcc/pcg-random
export class Rule30CARng {
	hi: number
	lo: number

	constructor(seedLo: number, seedHi: number = 0) {
		this.hi = seedHi >>> 0;
		this.lo = seedLo >>> 0;
	}

	step() {
		let rot = this.hi >>> 31;
		const rolhi = (this.hi << 1) | (this.lo >>> 31);
		const rollo = (this.lo << 1) | rot;
		rot = this.hi << 31;
		const rorhi = (this.hi >>> 1) | (this.lo << 31);
		const rorlo = (this.lo >>> 1) | rot;

		this.hi = rorhi ^ (this.hi | rolhi);
		this.lo = rorlo ^ (this.lo | rollo);
	}

	// NB. when sampling multiple bits it is MUCH BETTER to generate two integers at once like this
	// generating just `x` fails a PractRand FPF test at 4mb while using both is good until Node runs out of memory (“suspicious” DC6
	// result at 16mb)
	// why? i have no idea. it's convenient for the floats, at least. but you'd think it would be worse since the output should be more
	// correlated this way. who knows.
	// incidentally, there's a huge amount of design space here to explore which i have barely scratched the surface of. what bits to
	// sample, whether to sample both halves (hi and lo) of the state or just one, etc.
	// the current implementation has been arrived at experimentally using PractRand but is by no means the optimal design
	// oddly enough trying to make use of both hi and lo tends to make the results significantly worse, but it doesn't seem to matter much
	// which one is used. my initial thought was to use only lo since the right half of rule 30 is well-known to be more chaotic than the
	// left half. however hi does slightly better in practice, with no anomalies until 16mb. i suppose since it's circular the usual
	// left/right separation of rule 30 doesn't really apply?
	// ideally, it would be nice to get down to something that has good enough randomness but generates 8 bits per CA step instead of 4
	pair() {
		let x = 0 >>> 0, y = 0 >>> 0;
		for (let i = 0; i < 16; ++i) {
			x = (x << 2) | ((this.hi & 0x10000) >>> 15) | (this.hi & 1);
			y = (y << 2) | ((this.hi & 0x1000000) >>> 23) | ((this.hi & 0x100) >>> 8);
			this.step();
		}
		return [x,y];
	}

	// for very slightly better statistical properties
	//
	//     int32() {
	//         let k = 0;
	//         for (let i = 0; i < 32; ++i) {
	//             k = (k << 1) | (this.lo & 1);
	//             this.step();
	//         }
	//         return k >>> 0;
	//     }
	//
	// (obviously, would also have to also change random() to use int32())
	// this is about 3× slower

	int32() {
		let [x,y] = this.pair();
		// just throw away y because keeping that state around increases the size of rng instances and makes them harder to clone
		return x;
	}

	random() {
		const MASK_HI = 0x03ffffff >>> 0;
		const MASK_LO = 0x07ffffff >>> 0;
		const EXP = 0x8000000;
		const MANT = 0x20000000000000;

		// generate both low bits and high bits at once from the CA
		const [hi,lo] = this.pair();
		return ((hi & MASK_HI) * EXP + (lo & MASK_LO)) / MANT;
	}

	uniform(upper: number) {
		const mask = -1 >>> Math.clz32((upper - 1) | 1);
		let n = 0;
		do {
			n = this.int32() & mask;
		} while (n >= upper);
		return n;
	}
}
