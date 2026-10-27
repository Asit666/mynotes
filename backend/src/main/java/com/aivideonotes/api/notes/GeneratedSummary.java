package com.aivideonotes.api.notes;

import java.util.List;

public record GeneratedSummary(
		String title,
		String executiveSummary,
		List<String> coreThemes,
		List<String> keyTakeaways,
		List<String> reviewQuestions,
		String formattedMarkdown,
		long generatedAt) {

	public static String toMarkdown(
			String title,
			String executiveSummary,
			List<String> coreThemes,
			List<String> keyTakeaways,
			List<String> reviewQuestions) {
		var sb = new StringBuilder();
		sb.append("## Executive Summary\n\n");
		if (executiveSummary != null && !executiveSummary.isBlank()) {
			sb.append(executiveSummary.strip()).append("\n\n");
		}
		if (coreThemes != null && !coreThemes.isEmpty()) {
			sb.append("### Core Concepts & Architecture\n\n");
			for (var theme : coreThemes) {
				if (theme != null && !theme.isBlank()) {
					sb.append("- ").append(theme.strip()).append("\n");
				}
			}
			sb.append("\n");
		}
		if (keyTakeaways != null && !keyTakeaways.isEmpty()) {
			sb.append("### Key Takeaways & Rules\n\n");
			for (var point : keyTakeaways) {
				if (point != null && !point.isBlank()) {
					sb.append("- ").append(point.strip()).append("\n");
				}
			}
			sb.append("\n");
		}
		if (reviewQuestions != null && !reviewQuestions.isEmpty()) {
			sb.append("### Quick Review & Self-Check\n\n");
			for (var q : reviewQuestions) {
				if (q != null && !q.isBlank()) {
					sb.append("- ").append(q.strip()).append("\n");
				}
			}
			sb.append("\n");
		}
		return sb.toString().strip();
	}
}
