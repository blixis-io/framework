import { defineConfig } from "@blixis-io/cli";

export default defineConfig({
  // `blix run db:migrate` boots this module graph, which reads DATABASE_URL and JWT_SECRET from the environment.
  app: { module: "dist/blix-app.js", export: "AppModule" },
  deploy: {
    targets: {
      prod: {
        type: "docker",
        image: "saas-api",
        registry: { host: "docker.io" },
        // after: 'fly deploy --image "$BLIX_IMAGE"',  // tell your host to pick up the new image
      },
    },
  },
});
