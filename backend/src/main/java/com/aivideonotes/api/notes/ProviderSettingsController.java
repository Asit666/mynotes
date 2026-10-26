package com.aivideonotes.api.notes;

import java.util.Arrays;
import java.util.List;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/settings/providers")
public class ProviderSettingsController {

	private final ProviderCredentialStore credentials;
	private final NoteGenerationService noteGenerationService;

	public ProviderSettingsController(
			ProviderCredentialStore credentials,
			NoteGenerationService noteGenerationService) {
		this.credentials = credentials;
		this.noteGenerationService = noteGenerationService;
	}

	@GetMapping
	public List<ProviderStatus> list() {
		return Arrays.stream(AiProvider.values())
			.map(provider -> new ProviderStatus(provider.name(), provider.displayName(), credentials.isConfigured(provider)))
			.toList();
	}

	@PostMapping("/{provider}/validate")
	public ProviderValidation validate(@PathVariable String provider, @Valid @RequestBody SaveProviderRequest request) {
		var selectedProvider = AiProvider.from(provider);
		var apiKey = request.apiKey().strip();
		var models = noteGenerationService.listModels(selectedProvider, apiKey);
		if (models.isEmpty()) {
			throw new ProviderRequestException("The provider key is valid, but no note-generation models were returned.");
		}
		return new ProviderValidation(models);
	}

	@PutMapping("/{provider}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void save(@PathVariable String provider, @Valid @RequestBody SaveProviderRequest request) {
		credentials.save(AiProvider.from(provider), request.apiKey().strip());
	}

	@DeleteMapping("/{provider}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void delete(@PathVariable String provider) {
		credentials.delete(AiProvider.from(provider));
	}

	public record ProviderStatus(String id, String name, boolean configured) {
	}

	public record ProviderValidation(List<String> models) {
	}

	public record SaveProviderRequest(
			@NotBlank @Size(max = 2048) String apiKey) {
	}
}
