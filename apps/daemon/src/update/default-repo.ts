// The release repo slug (`FLUX_RELEASE_REPO` overrides it via config). One constant shared by the
// downloader (fetch-release.ts) and the discovery API (discover-latest.ts) so the two always
// target the same repo — never duplicate the slug.
export const defaultRepo = 'Musqet-Rich/flux';
