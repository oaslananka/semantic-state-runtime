// Source-of-truth SemVer policy shared by private workspace packaging and npm release tests.
export function npmDistTag(version) {
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:alpha|beta|rc)\.(?:0|[1-9]\d*))?$/.test(version)) {
    throw new Error("Expected a stable SemVer or an explicitly numbered alpha/beta/rc prerelease");
  }
  return version.includes("-") ? "next" : "latest";
}
