package com.aivideonotes.api.notes;

import java.util.List;

public record GeneratedNote(
		String title,
		String explanation,
		List<String> keyPoints,
		long startTimestampSeconds) {
}
