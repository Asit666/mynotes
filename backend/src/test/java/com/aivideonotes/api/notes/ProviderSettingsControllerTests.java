package com.aivideonotes.api.notes;

import java.util.List;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ProviderSettingsControllerTests {

	@Test
	void validatesKeyAndReturnsModelsBeforeSaving() {
		var credentials = mock(ProviderCredentialStore.class);
		var noteGenerationService = mock(NoteGenerationService.class);
		when(noteGenerationService.listModels(AiProvider.OPENAI, "valid-key"))
				.thenReturn(List.of("gpt-4.1-mini"));
		var controller = new ProviderSettingsController(credentials, noteGenerationService);

		var result = controller.validate(
			"OPENAI",
			new ProviderSettingsController.SaveProviderRequest(" valid-key "));
		controller.save("OPENAI", new ProviderSettingsController.SaveProviderRequest(" valid-key "));

		verify(credentials).save(AiProvider.OPENAI, "valid-key");
		org.assertj.core.api.Assertions.assertThat(result.models()).containsExactly("gpt-4.1-mini");
	}

	@Test
	void doesNotSaveAKeyWhenValidationFails() {
		var credentials = mock(ProviderCredentialStore.class);
		var noteGenerationService = mock(NoteGenerationService.class);
		when(noteGenerationService.listModels(AiProvider.OPENAI, "invalid-key"))
				.thenThrow(new ProviderRequestException("The provider key could not be validated."));
		var controller = new ProviderSettingsController(credentials, noteGenerationService);

		assertThatThrownBy(() -> controller.validate(
			"OPENAI",
			new ProviderSettingsController.SaveProviderRequest("invalid-key")))
			.isInstanceOf(ProviderRequestException.class);
		verify(credentials, never()).save(AiProvider.OPENAI, "invalid-key");
	}
}
