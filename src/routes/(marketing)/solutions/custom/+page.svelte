<script lang="ts">
	import SolutionPage from "$lib/components/marketing/SolutionPage.svelte";
</script>

<svelte:head>
	<title>Custom Vinyl, HTV & Gasket Cutting Software — OmniPlot</title>
	<meta
		name="description"
		content="OmniPlot handles any custom drag-knife or vinyl cutting job: apparel HTV, gaskets, device skins, stencils, and one-off projects — nested and exported for any plotter."
	/>
	<link rel="canonical" href="https://omniplot.app/solutions/custom" />
</svelte:head>

<SolutionPage
	slug="custom"
	eyebrow="Custom"
	title="If your plotter can cut it, OmniPlot can nest it"
	sub="Not every job fits a vehicle or a building. Save any custom project — apparel, gaskets, device skins, stencils — under its own name and nest it like everything else."
	useCases={[
		{ title: "Apparel & HTV", desc: "Heat transfer vinyl designs for shirts, jerseys, and team apparel, nested to minimize press-sheet waste." },
		{ title: "Gaskets & industrial parts", desc: "Drag-knife-ready gasket and industrial part patterns for production runs." },
		{ title: "Device skins & screen protectors", desc: "Precision-cut skins and protectors for phones, laptops, and consoles." },
		{ title: "Sandblast stencils", desc: "Resist stencils for glass and stone sandblasting work." },
		{ title: "Leather & upholstery", desc: "Custom leather panel and upholstery patterns cut to exact dimensions." },
		{ title: "Packaging dielines", desc: "One-off and short-run packaging dieline cuts for prototyping and small batches." },
	]}
	steps={[
		{ title: "Name the project", desc: "Custom subjects skip the vehicle/property fields entirely — just give the project a name." },
		{ title: "Upload your pattern", desc: "Vectorize a traced design or import an existing SVG path directly into the project." },
		{ title: "Nest and export", desc: "Auto-nesting handles material efficiency; export to HPGL, SVG, or DXF for any plotter or downstream tool." },
	]}
	caseStudy={{
		company: "Apex Custom Cuts",
		summary: "A multi-discipline cutting shop uses OmniPlot for everything that doesn't fit a standard vehicle or property job — apparel runs, gaskets, and one-off prototypes.",
		challenge: "Custom and short-run jobs didn't fit any off-the-shelf cutting software's project model, so the shop tracked them in spreadsheets separate from their main workflow.",
		solution: "Every custom job gets a named project in OmniPlot's library, with the same auto-nesting and export pipeline used for vehicle and commercial work.",
		outcome: "One tool now covers every job type the shop takes on, with no more spreadsheet tracking or separate software for one-off work.",
	}}
/>
