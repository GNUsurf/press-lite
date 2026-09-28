---
title: Raw HTML in a post is escaped
description: This fixture carries a script tag and an image with an onerror handler to prove neither survives rendering as markup.
date: 2026-01-20
slug: raw-html-is-escaped
tags: [security]
draft: false
---

Before <script>alert(1)</script> after.

<img src=x onerror=alert(2)>

[click](<javascript:alert(3)>)
