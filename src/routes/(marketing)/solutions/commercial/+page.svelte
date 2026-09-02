<script lang="ts">
	import SolutionPage from "$lib/components/marketing/SolutionPage.svelte";
</script>

<svelte:head>
	<title>Commercial Window Film & Signage Cutting Software — OmniPlot</title>
	<meta
		name="description"
		content="OmniPlot supports commercial glass film, storefront signage, and safety/security film installers with reusable property patterns, auto-nesting, and universal plotter export."
	/>
	<link rel="canonical" href="https://omniplot.app/solutions/commercial" />
</svelte:head>

<SolutionPage
	slug="commercial"
	eyebrow="Commercial"
	title="Storefronts, offices, and safety film — nested and cut right"
	sub="Large curtain walls and repeat storefront layouts eat material fast. OmniPlot nests every panel efficiently and keeps a reusable pattern library per building."
	useCases={[
		{ title: "Storefront & display glass", desc: "Frosted privacy bands, branding film, and display-window graphics for retail storefronts." },
		{ title: "Office & conference glass", desc: "Privacy and decorative film for interior office glass and conference rooms." },
		{ title: "Safety & security film", desc: "Shatter-resistant and anti-graffiti film for entry doors, lobbies, and transom windows." },
		{ title: "Curtain walls", desc: "Large-format panel layouts nested across multiple rolls for full curtain-wall coverage." },
		{ title: "Storefront signage", desc: "Cut vinyl lettering and graphics for window signage and branding." },
		{ title: "Floor graphics", desc: "Directional and branding floor decals cut and nested alongside window jobs." },
	]}
	steps={[
		{ title: "Save the building", desc: "Create a subject per property or suite, with an address and property label for easy lookup on repeat visits." },
		{ title: "Template each panel", desc: "Upload or vectorize each glass panel or graphic once — reuse it for maintenance and re-films." },
		{ title: "Nest across rolls", desc: "Auto-nesting spans large multi-panel jobs across as many rolls as needed with minimal waste per roll." },
	]}
	caseStudy={{
		company: "Main Street Commercial Films",
		summary: "A commercial film and signage contractor consolidated storefront, office, and safety-film jobs into one OmniPlot workflow.",
		challenge: "Crews were quoting material by eye on large curtain-wall jobs, leading to inconsistent waste and re-orders mid-install.",
		solution: "Every building is saved as a subject with per-panel patterns; auto-nesting spans multi-roll jobs so material use is predictable before the crew leaves the shop.",
		outcome: "Fewer mid-job material re-orders and faster, more accurate quoting on large commercial glass jobs.",
	}}
/>
