export const enum Strategy { Nige = 1, Senkou, Sasi, Oikomi, Oonige }
export const enum Aptitude { S, A, B, C, D, E, F, G }

export interface HorseParameters {
	speed: number
	stamina: number
	power: number
	guts: number
	int: number
	strategy: Strategy
	distanceAptitude: Aptitude
	surfaceAptitude: Aptitude
	strategyAptitude: Aptitude
}

export namespace StrategyHelpers {
	export function assertIsStrategy(strategy: number): asserts strategy is Strategy {
		if (!(
		   strategy == Strategy.Nige
		|| strategy == Strategy.Senkou
		|| strategy == Strategy.Sasi
		|| strategy == Strategy.Oikomi
		|| strategy == Strategy.Oonige)) {
			throw new Error('bad strategy');
		}
	}

	export function strategyMatches(s1: Strategy, s2: Strategy) {
		return s1 == s2 || (s1 == Strategy.Nige && s2 == Strategy.Oonige) || (s1 == Strategy.Oonige && s2 == Strategy.Nige);
	}
}
