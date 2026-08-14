export function findForbiddenTrackedEvidence(paths) {
  return paths.filter((path) =>
    /(^|\/)\.phase7-30f-evidence.*\.json$/i.test(path),
  )
}

export function findForbiddenTrackedEnvironment(paths) {
  return paths.filter((path) => {
    const isEnvironmentFile =
      /(^|\/)\.env(?:$|\.)/i.test(path) ||
      /(^|\/)\.dev\.vars(?:$|\.)/i.test(path)
    return isEnvironmentFile && !/\.example$/i.test(path)
  })
}

export function findForbiddenTrackedRuntimeArtifacts(paths) {
  return paths.filter(
    (path) =>
      /^(?:dist|playwright-report|test-results|supabase\/.temp)(?:\/|$)/i.test(
        path,
      ) ||
      /(^|\/)(?:dumps?|backups?|logs?)(?:\/|$)/i.test(path) ||
      /\.(?:dump|bak|backup|sqlite|sqlite3|log|trace)$/i.test(path),
  )
}
