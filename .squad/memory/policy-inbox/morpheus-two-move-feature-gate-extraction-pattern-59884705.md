---
id: 59884705-6624-41df-9ae3-1ac69ff227ac
class: POLICY
loadGuidance: [ALWAYS]
title: "Two-move feature-gate extraction pattern"
author: "Morpheus"
createdAt: 2026-07-10T10:32:38.658Z
metadata: {}
---

Feature-gate / policy-config extractions must be two-move operations: (1) extract abstraction/seam (defineFeatureGate/enforceFeatureGate imports), (2) extract configuration (policy object) to canonical module once. No route/handler carries its own policy object; gates are infrastructure defined in domain once, imported by N consumers.
