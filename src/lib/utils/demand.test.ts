import { describe, expect, it } from "vitest";
import { demandId, demandValid, hasVoted, nextVote, votesForYear } from "./demand";

describe("demandId", () => {
	it("folds spelling variants of one model into one record", () => {
		const ids = [
			demandId({ make: "Toyota", model: "GR86" }),
			demandId({ make: "toyota ", model: "GR-86" }),
			demandId({ make: "Toyota", model: "Toyota GR 86" }),
		];
		expect(new Set(ids).size).toBe(1);
	});
	it("uses make nicknames and keeps different models apart", () => {
		expect(demandId({ make: "Chevy", model: "Silverado" })).toBe(demandId({ make: "Chevrolet", model: "Silverado" }));
		expect(demandId({ make: "Ford", model: "F-150" })).not.toBe(demandId({ make: "Ford", model: "F-250" }));
	});
	it("keys property requests by type and label", () => {
		expect(demandId({ projectType: "residential", model: "Andersen 400" })).toBe("residential__andersen-400");
		expect(demandValid({ projectType: "residential", model: " " })).toBe(false);
		expect(demandValid({ make: "Ford", model: "" })).toBe(false);
	});
});

describe("votes", () => {
	it("a person voting for several years counts once, and any-year covers every year", () => {
		let mine = nextVote(undefined, 2021, true)!;
		mine = nextVote(mine, 2022, true)!;
		expect(mine).toEqual({ any: false, years: [2021, 2022] });
		expect(hasVoted(mine, 2022)).toBe(true);
		expect(hasVoted(mine, 2023)).toBe(false);
		expect(nextVote(mine, 2021, false)).toEqual({ any: false, years: [2022] });
		expect(nextVote({ any: false, years: [2022] }, 2022, false)).toBeNull();
		expect(hasVoted({ any: true, years: [] }, 2030)).toBe(true);
	});
	it("year figures add the any-year voters", () => {
		const d = { votes: 5, anyVotes: 2, yearVotes: { "2021": 2 } };
		expect(votesForYear(d, 2021)).toBe(4);
		expect(votesForYear(d, 2019)).toBe(2);
		expect(votesForYear(d, undefined)).toBe(5);
	});
});
