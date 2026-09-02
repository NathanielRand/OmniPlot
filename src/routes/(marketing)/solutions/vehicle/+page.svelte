<script lang="ts">
	import SolutionPage from "$lib/components/marketing/SolutionPage.svelte";
</script>

<svelte:head>
	<title>PPF & Window Tint Cutting Software for Auto Shops — OmniPlot</title>
	<meta
		name="description"
		content="OmniPlot is browser-based PPF and window tint cutting software for auto shops: vehicle template library, auto-nesting, and universal plotter export. No install required."
	/>
	<link rel="canonical" href="https://omniplot.app/solutions/vehicle" />
</svelte:head>

<SolutionPage
	slug="vehicle"
	eyebrow="Vehicle"
	title="Cut PPF and window tint faster, with less waste"
	sub="A professionally measured template library for every major make and model, auto-nesting that maximizes material efficiency, and one browser tab that drives any plotter in your shop."
	useCases={[
		{ title: "Paint protection film", desc: "Full-body, partial, and edge-only PPF kits across hood, fenders, bumpers, doors, mirrors, and rockers." },
		{ title: "Window tint", desc: "Precision-cut tint for windshield strips, side windows, sunroofs, and quarter/vent glass." },
		{ title: "Wraps & vinyl graphics", desc: "Panel wraps, decals, and accent striping cut from the same nested sheet as your PPF." },
		{ title: "Headlight & chrome delete", desc: "Smoked headlight film and chrome-delete overlays templated per model year." },
		{ title: "Paint & airbrush masks", desc: "Custom masking shapes for two-tone paint jobs and airbrush work." },
		{ title: "Multi-plotter shops", desc: "Run Roland, Graphtec, Mimaki, USCutter, and Summa cutters from the same job queue." },
	]}
	steps={[
		{ title: "Pick the vehicle", desc: "Search by make, model, and year in the library — 20+ vehicles seeded with verified PPF and window tint zones." },
		{ title: "Select zones and nest", desc: "Add the zones you need to Studio; auto-nesting fills your roll with minimal waste using skyline bin-packing." },
		{ title: "Cut", desc: "Export to HPGL/SVG/DXF or send straight to a connected plotter, with built-in diagnostics if a cut fails." },
	]}
	caseStudy={{
		company: "Tampa Bay Wraps",
		summary: "A three-bay PPF and wrap shop switched from desktop-only cutting software to OmniPlot to get their techs working from tablets on the shop floor.",
		challenge: "Desktop software tied every job to one workstation, and switching between PPF and tint patterns meant relaunching separate tools.",
		solution: "OmniPlot's browser-based Studio runs on any tablet, with PPF and window tint patterns in the same library and auto-nesting handling material efficiency automatically.",
		outcome: "Techs pull up jobs bay-side without walking back to a shared PC, and material waste dropped with every roll nested automatically instead of by eye.",
	}}
/>
