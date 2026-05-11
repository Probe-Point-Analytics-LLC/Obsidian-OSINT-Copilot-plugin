import { describe, it, expect } from "vitest";
import { getEntityIconForEntity, type Entity } from "../src/entities/types";

function e(partial: Partial<Entity> & Pick<Entity, "id" | "type" | "label">): Entity {
	return {
		properties: {},
		...partial,
	};
}

describe("getEntityIconForEntity", () => {
	it("uses Address icon for Address entities", () => {
		const icon = getEntityIconForEntity(
			e({ id: "1", type: "Address", label: "Main St", properties: {} }),
		);
		expect(icon).toBe("📍");
	});

	it("resolves legacy StixLocation to GeoLocation icon", () => {
		const icon = getEntityIconForEntity(
			e({
				id: "2",
				type: "StixLocation",
				label: "Somewhere",
				properties: {},
			}),
		);
		expect(icon).toBe("📍");
	});

	it("normalizes lowercase type to PascalCase for icon lookup", () => {
		const icon = getEntityIconForEntity(
			e({ id: "3", type: "person", label: "Alice", properties: {} }),
		);
		expect(icon).toBe("👤");
	});

	it("prefers ftmSchema when type string differs", () => {
		const icon = getEntityIconForEntity(
			e({
				id: "4",
				type: "UnknownThing",
				ftmSchema: "Company",
				label: "Acme",
				properties: {},
			}),
		);
		expect(icon).toBe("🏢");
	});

	it("falls back to default for unknown types", () => {
		const icon = getEntityIconForEntity(
			e({ id: "5", type: "XyzUnknownType999", label: "?", properties: {} }),
		);
		expect(icon).toBe("📦");
	});

	it("maps IntelligenceReport alias target", () => {
		const icon = getEntityIconForEntity(
			e({ id: "6", type: "StixReport", label: "R1", properties: {} }),
		);
		expect(icon).toBe("📑");
	});
});
