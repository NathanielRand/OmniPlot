<script lang="ts">
	import SolutionPage from "$lib/components/marketing/SolutionPage.svelte";
</script>

<svelte:head>
	<title>Window Film Cutting Software for Residential Installers — OmniPlot</title>
	<meta
		name="description"
		content="OmniPlot helps residential window film and home vinyl installers measure once, nest efficiently, and cut accurately — from solar film to decorative glass to wall decals."
	/>
	<link rel="canonical" href="https://omniplot.app/solutions/residential" />
</svelte:head>

<SolutionPage
	slug="residential"
	eyebrow="Residential"
	title="Precision cutting for every room in the house"
	sub="Save a pattern per property, per window, and reuse it on the next visit. OmniPlot nests home window film and decorative vinyl jobs with the same efficiency engine built for PPF shops."
	useCases={[
		{ title: "Solar & privacy film", desc: "Heat-rejecting and privacy tint for living rooms, bedrooms, and sunrooms." },
		{ title: "Decorative & security film", desc: "Frosted, stained-glass-look, and shatter-resistant security film for entry doors and sidelights." },
		{ title: "Shower & bathroom glass", desc: "Custom-fit privacy and decorative film for shower enclosures and bathroom windows." },
		{ title: "Wall decals & accents", desc: "Vinyl wall graphics and accent decals cut to size for any room." },
		{ title: "Skylights & sunrooms", desc: "Odd-shaped skylight and sunroom glass templated and nested efficiently." },
		{ title: "Sliding glass doors", desc: "Full-panel film for sliding and French doors, measured once and reused." },
	]}
	steps={[
		{ title: "Measure the property", desc: "Save each window as a subject with a property address and label — no vehicle catalog needed." },
		{ title: "Upload or reuse patterns", desc: "Vectorize a traced pattern once, or reuse a saved shape from a prior visit to the same property." },
		{ title: "Nest and cut", desc: "Auto-nesting fits every panel onto the roll with minimal waste, then exports or sends straight to your plotter." },
	]}
	caseStudy={{
		company: "ClearShield Residential (Portland)",
		summary: "A home window film installer moved from paper templates and hand-measured cuts to OmniPlot's saved-pattern workflow.",
		challenge: "Every job meant re-measuring windows on-site with no way to save a pattern for a repeat customer or a multi-window property.",
		solution: "Installers now save each window as a subject with a property label, upload the traced pattern once, and nest every panel for the job in one Studio session.",
		outcome: "Repeat jobs at the same property go from a full re-measure to a five-minute pattern pull, and roll waste dropped with auto-nesting replacing hand layout.",
	}}
/>
