package com.aivideonotes.api.notes;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/notes")
public class AudioTranscriptionController {

	private final NoteGenerationService noteGenerationService;

	public AudioTranscriptionController(NoteGenerationService noteGenerationService) {
		this.noteGenerationService = noteGenerationService;
	}

	@PostMapping("/transcribe")
	public TranscriptionResponse transcribe(@Valid @RequestBody TranscribeAudioRequest request) {
		return new TranscriptionResponse(noteGenerationService.transcribeAudio(request.audioBase64()));
	}

	public record TranscribeAudioRequest(
			@NotBlank @Size(max = 34_000_000) String audioBase64) {
	}

	public record TranscriptionResponse(String transcriptText) {
	}
}
