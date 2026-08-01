# Hasan Kazmi — Research & Decision Systems

[![Quality checks](https://github.com/hr185882-creator/research-decision-systems/actions/workflows/quality.yml/badge.svg)](https://github.com/hr185882-creator/research-decision-systems/actions/workflows/quality.yml)
[![Live site smoke test](https://github.com/hr185882-creator/research-decision-systems/actions/workflows/live-smoke.yml/badge.svg)](https://github.com/hr185882-creator/research-decision-systems/actions/workflows/live-smoke.yml)

Canonical source repository for Hasan Raza Kazmi's recruiter-facing portfolio and two public research case studies.

## Live site

https://hasan-research-systems.vercel.app/

## Canonical deployment contract

- This repository is the intended source of truth for the Vercel project `hasan-research-systems`.
- The repository root is deployed as a static site with no build command.
- `index.html` is the recruiter-facing homepage.
- `eu-chat-control.html` is served at `/eu-chat-control`.
- `russian-jfk-dossier.html` is served at `/russian-jfk-dossier`.
- `vercel.json` enables clean URLs and security headers.
- The scheduled smoke workflow verifies both HTTP success and page-specific content markers.

A direct one-file Vercel upload can replace the homepage while silently removing the research routes. Production should therefore be deployed from this repository or from a complete artifact containing every tracked route and asset.

## Portfolio scope

The homepage links to the broader public portfolio:

- AURORA GRID / GrindWire
- EU Chat Control Monitor
- The Russian JFK Dossier
- RECORD LOCK
- The Epstein Record
- U.S.–Israel Policy Network

## Design and publication principles

- demonstrated capability before unsupported positioning;
- primary records and explicit source hierarchy;
- clear authorship and AI-assistance disclosure;
- explicit uncertainty and analytical limits;
- no fake live indicators or dashboard theater;
- responsive static HTML and CSS;
- Open Graph metadata for professional sharing;
- production monitoring that fails on wrong content, not only empty responses.

## Role and contact

Hasan Raza Kazmi directs the research framing, analytical structure, editorial review, product architecture, quality assurance, and deployment decisions.

Professional contact: Grindwireproject@gmail.com
