// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  integrations: [
    starlight({
      title: "Blixis Framework",
      description:
        "An API-first CMS framework with its own dependency injection container, decorators, and HTTP layer.",
      sidebar: [
        { label: "Start Here", items: [{ autogenerate: { directory: "start-here" } }] },
        { label: "Core Concepts", items: [{ autogenerate: { directory: "concepts" } }] },
        { label: "Guides", items: [{ autogenerate: { directory: "guides" } }] },
        { label: "Tutorials", items: [{ autogenerate: { directory: "tutorials" } }] },
        { label: "Examples", items: [{ autogenerate: { directory: "examples" } }] },
        { label: "API Reference", items: [{ autogenerate: { directory: "reference" } }] },
        { label: "Architecture", items: [{ autogenerate: { directory: "architecture" } }] },
      ],
    }),
  ],
});
