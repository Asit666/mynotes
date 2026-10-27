package com.aivideonotes.api.notes;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record AskNoteRequest(
		@NotBlank @Size(max = 30) String provider,
		@NotBlank @Size(max = 200) String model,
		@NotBlank @Size(max = 200) String videoTitle,
		@Size(max = 2048) String videoUrl,
		@NotBlank @Size(max = 5000) String prompt,
		@Size(max = 40000) String existingNotesContext,
		@Min(0) Long timestampSeconds) {

	public AskNoteRequest(String provider, String model, String videoTitle, String videoUrl, String prompt, String existingNotesContext) {
		this(provider, model, videoTitle, videoUrl, prompt, existingNotesContext, 0L);
	}
}
