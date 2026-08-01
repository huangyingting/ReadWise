import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

type AuditSeverity = "info" | "low" | "moderate" | "high" | "critical";

type AuditAdvisory = {
  source?: number;
  name?: string;
  url?: string;
  severity?: AuditSeverity;
};

type AuditVulnerability = {
  name: string;
  severity: AuditSeverity;
  via: Array<string | AuditAdvisory>;
  nodes: string[];
};

export type AuditReport = {
  auditReportVersion: number;
  vulnerabilities: Record<string, AuditVulnerability>;
  metadata?: {
    vulnerabilities?: Partial<Record<AuditSeverity | "total", number>>;
  };
};

type LockedPackage = {
  version?: string;
  dev?: boolean;
};

export type PackageLock = {
  lockfileVersion?: number;
  packages: Record<string, LockedPackage>;
};

export type DependencyAuditResult = {
  ok: boolean;
  exceptionApplied?: boolean;
  highOrCriticalCount: number;
  reason?: string;
};

const BRACE_EXPANSION_ADVISORY =
  "https://github.com/advisories/GHSA-mh99-v99m-4gvg";
const PATCHED_BRACE_EXPANSION_BACKPORT = "1.1.18";
const BLOCKING_SEVERITIES = new Set<AuditSeverity>(["high", "critical"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function blockingVulnerabilities(report: AuditReport): Array<[string, AuditVulnerability]> {
  return Object.entries(report.vulnerabilities).filter(([, vulnerability]) =>
    BLOCKING_SEVERITIES.has(vulnerability.severity),
  );
}

function hasExpectedReportShape(report: AuditReport): boolean {
  if (
    report.auditReportVersion !== 2 ||
    !isRecord(report.vulnerabilities) ||
    !isRecord(report.metadata) ||
    !isRecord(report.metadata.vulnerabilities)
  ) {
    return false;
  }

  const high = report.metadata.vulnerabilities.high;
  const critical = report.metadata.vulnerabilities.critical;
  if (
    !Number.isInteger(high) ||
    !Number.isInteger(critical) ||
    (high ?? -1) < 0 ||
    (critical ?? -1) < 0
  ) {
    return false;
  }

  for (const vulnerability of Object.values(report.vulnerabilities)) {
    if (
      !isRecord(vulnerability) ||
      typeof vulnerability.name !== "string" ||
      typeof vulnerability.severity !== "string" ||
      !Array.isArray(vulnerability.via) ||
      !Array.isArray(vulnerability.nodes)
    ) {
      return false;
    }
  }

  return blockingVulnerabilities(report).length === high! + critical!;
}

function hasExpectedLockfileShape(lockfile: PackageLock): boolean {
  return lockfile.lockfileVersion === 3 && isRecord(lockfile.packages);
}

function rootAdvisoryUrls(
  report: AuditReport,
  vulnerabilityName: string,
  visiting = new Set<string>(),
): Set<string> | null {
  if (visiting.has(vulnerabilityName)) return null;

  const vulnerability = report.vulnerabilities[vulnerabilityName];
  if (!vulnerability || !Array.isArray(vulnerability.via)) return null;

  const nextVisiting = new Set(visiting);
  nextVisiting.add(vulnerabilityName);
  const urls = new Set<string>();

  for (const cause of vulnerability.via) {
    if (typeof cause === "string") {
      const nestedUrls = rootAdvisoryUrls(report, cause, nextVisiting);
      if (!nestedUrls) return null;
      for (const url of nestedUrls) urls.add(url);
      continue;
    }

    if (!cause || typeof cause.url !== "string" || cause.url.length === 0) return null;
    urls.add(cause.url);
  }

  return urls.size > 0 ? urls : null;
}

function hasOnlyAllowlistedRootCause(report: AuditReport): boolean {
  for (const [name] of blockingVulnerabilities(report)) {
    const urls = rootAdvisoryUrls(report, name);
    if (!urls || urls.size !== 1 || !urls.has(BRACE_EXPANSION_ADVISORY)) return false;
  }
  return true;
}

function hasPatchedDevOnlyBackport(report: AuditReport, lockfile: PackageLock): boolean {
  const vulnerability = report.vulnerabilities["brace-expansion"];
  if (!vulnerability || vulnerability.nodes.length === 0) return false;

  return vulnerability.nodes.every((nodePath) => {
    const lockedPackage = lockfile.packages[nodePath];
    return (
      lockedPackage?.version === PATCHED_BRACE_EXPANSION_BACKPORT &&
      lockedPackage.dev === true
    );
  });
}

export function evaluateDependencyAudits(
  fullReport: AuditReport,
  productionReport: AuditReport,
  lockfile: PackageLock,
): DependencyAuditResult {
  if (
    !hasExpectedReportShape(fullReport) ||
    !hasExpectedReportShape(productionReport) ||
    !hasExpectedLockfileShape(lockfile)
  ) {
    return {
      ok: false,
      highOrCriticalCount: 0,
      reason: "Dependency audit schema or metadata is not recognized.",
    };
  }

  const productionBlocking = blockingVulnerabilities(productionReport);
  const fullBlocking = blockingVulnerabilities(fullReport);

  if (productionBlocking.length > 0) {
    return {
      ok: false,
      highOrCriticalCount: fullBlocking.length,
      reason: "HIGH or CRITICAL advisory found in the production dependency graph.",
    };
  }

  if (fullBlocking.length === 0) {
    return {
      ok: true,
      exceptionApplied: false,
      highOrCriticalCount: 0,
    };
  }

  if (!hasOnlyAllowlistedRootCause(fullReport)) {
    return {
      ok: false,
      highOrCriticalCount: fullBlocking.length,
      reason: "HIGH or CRITICAL advisory is not allowlisted.",
    };
  }

  if (!hasPatchedDevOnlyBackport(fullReport, lockfile)) {
    return {
      ok: false,
      highOrCriticalCount: fullBlocking.length,
      reason: "The advisory exception requires the patched dev-only backport.",
    };
  }

  return {
    ok: true,
    exceptionApplied: true,
    highOrCriticalCount: fullBlocking.length,
  };
}

function runNpmAudit(args: string[]): AuditReport {
  const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmExecutable, ["audit", "--json", ...args], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error || !result.stdout.trim()) {
    throw new Error("npm audit did not return a JSON report");
  }

  return JSON.parse(result.stdout) as AuditReport;
}

export function main(): number {
  try {
    const fullReport = runNpmAudit([]);
    const productionReport = runNpmAudit(["--omit=dev"]);
    const lockfile = JSON.parse(readFileSync("package-lock.json", "utf8")) as PackageLock;
    const result = evaluateDependencyAudits(fullReport, productionReport, lockfile);

    if (!result.ok) {
      console.error(`Dependency audit failed: ${result.reason}`);
      return 1;
    }

    if (result.exceptionApplied) {
      console.log(
        `Dependency audit passed with the documented ${BRACE_EXPANSION_ADVISORY} dev-only backport exception.`,
      );
    } else {
      console.log("Dependency audit passed with no HIGH or CRITICAL advisories.");
    }
    return 0;
  } catch {
    console.error("Dependency audit failed: unable to validate npm audit output.");
    return 1;
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  process.exitCode = main();
}
