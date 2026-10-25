package com.aivideonotes.api;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.junit.jupiter.api.BeforeEach;
import com.aivideonotes.api.notes.AiProvider;
import com.aivideonotes.api.notes.ProviderCredentialStore;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.mockito.Mockito.verify;

@SpringBootTest
@AutoConfigureMockMvc
class AiVideoNotesApiApplicationTests {

	@Autowired
	private MockMvc mockMvc;

	@MockitoBean
	private ProviderCredentialStore credentials;

	@BeforeEach
	void clearProviderCredentials() {
		when(credentials.get(AiProvider.OPENAI)).thenReturn("");
	}

	@Test
	void contextLoads() {
	}

	@Test
	void healthEndpointIsAvailableWithoutProviderCredentials() throws Exception {
		mockMvc.perform(get("/api/health"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.status").value("ok"));
	}

	@Test
	void generationRejectsBlankTranscript() throws Exception {
		mockMvc.perform(post("/api/notes/generate")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
					  "provider": "OPENAI",
					  "model": "gpt-4.1-mini",
					  "videoTitle": "Lecture",
					  "videoUrl": "https://www.youtube.com/watch?v=example",
					  "timestampSeconds": 30,
					  "transcriptText": ""
					}
					"""))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.message").exists());
	}

	@Test
	void generationReportsMissingProviderConfiguration() throws Exception {
		mockMvc.perform(post("/api/notes/generate")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
					  "provider": "OPENAI",
					  "model": "gpt-4.1-mini",
					  "videoTitle": "Lecture",
					  "videoUrl": "https://www.youtube.com/watch?v=example",
					  "timestampSeconds": 30,
					  "transcriptText": "A transcript segment."
					}
					"""))
			.andExpect(status().isServiceUnavailable())
			.andExpect(jsonPath("$.message").value("OpenAI is not configured. Add its API key in Settings."));
	}

	@Test
	void transcriptionReportsMissingOpenAiConfiguration() throws Exception {
		mockMvc.perform(post("/api/notes/transcribe")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{"audioBase64":"AQID"}
					"""))
			.andExpect(status().isServiceUnavailable())
			.andExpect(jsonPath("$.message").value("OpenAI is not configured. Add its API key in Settings."));
	}

	@Test
	void generationRejectsUnsupportedProvider() throws Exception {
		mockMvc.perform(post("/api/notes/generate")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
					  "provider": "UNKNOWN",
					  "model": "some-model",
					  "videoTitle": "Lecture",
					  "videoUrl": "https://example.com/course",
					  "timestampSeconds": 30,
					  "transcriptText": "A transcript segment."
					}
					"""))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.message").value("Choose OpenAI, Anthropic, or Google Gemini."));
	}

	@Test
	void providerKeySettingsStoresWithoutReturningTheSecret() throws Exception {
		mockMvc.perform(put("/api/settings/providers/OPENAI")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{"apiKey":"unit-test-key"}
					"""))
			.andExpect(status().isNoContent());
		verify(credentials).save(AiProvider.OPENAI, "unit-test-key");
	}
}
