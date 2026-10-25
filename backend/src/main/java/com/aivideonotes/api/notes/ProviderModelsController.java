package com.aivideonotes.api.notes;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/ai")
public class ProviderModelsController {

	private final NoteGenerationService noteGenerationService;

	public ProviderModelsController(NoteGenerationService noteGenerationService) {
		this.noteGenerationService = noteGenerationService;
	}

	@GetMapping("/models")
	public List<String> models(@RequestParam String provider) {
		return noteGenerationService.listModels(AiProvider.from(provider));
	}
}
