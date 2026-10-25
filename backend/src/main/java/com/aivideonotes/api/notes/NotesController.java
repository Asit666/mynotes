package com.aivideonotes.api.notes;

import jakarta.validation.Valid;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/notes")
public class NotesController {

	private final NoteGenerationService noteGenerationService;

	public NotesController(NoteGenerationService noteGenerationService) {
		this.noteGenerationService = noteGenerationService;
	}

	@PostMapping("/generate")
	public GeneratedNote generate(@Valid @RequestBody GenerateNoteRequest request) {
		return noteGenerationService.generate(request);
	}
}
