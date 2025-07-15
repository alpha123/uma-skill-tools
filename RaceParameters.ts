export type Mood = -2 | -1 | 0 | 1 | 2;
export const enum GroundCondition { Good = 1, Yielding, Soft, Heavy }
export const enum Weather { Sunny = 1, Cloudy, Rainy, Snowy }
export const enum Season { Spring = 1, Summer, Autumn, Winter, Sakura }
export const enum Time { NoTime, Morning, Midday, Evening, Night }
export const enum Grade { G1 = 100, G2 = 200, G3 = 300, OP = 400, PreOP = 700, Maiden = 800, Debut = 900, Daily = 999 }

export interface RaceParameters {
	readonly mood: Mood
	readonly groundCondition: GroundCondition
	readonly weather: Weather
	readonly season: Season
	readonly time: Time
	readonly grade: Grade
	readonly popularity: number
	readonly orderRange?: [number, number]
	readonly numUmas?: number
	readonly skillId: string
}
