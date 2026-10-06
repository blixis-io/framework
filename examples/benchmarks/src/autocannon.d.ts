declare module "autocannon" {
  interface Options {
    url: string;
    connections?: number;
    duration?: number;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    pipelining?: number;
  }

  interface Percentiles {
    average: number;
    p50: number;
    p97_5: number;
    p99: number;
    max: number;
  }

  interface Result {
    requests: { average: number; total: number };
    latency: Percentiles;
    errors: number;
    timeouts: number;
    non2xx: number;
    "2xx": number;
  }

  function autocannon(options: Options): Promise<Result>;
  export default autocannon;
}
