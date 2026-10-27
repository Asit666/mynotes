package com.aivideonotes.api.notes;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import tools.jackson.databind.json.JsonMapper;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class NoteGenerationServiceTests {

	@Test
	void generatesATimestampedNoteThroughTheOpenAiApi() {
		var builder = RestClient.builder();
		var server = MockRestServiceServer.bindTo(builder).build();
		var credentials = mock(ProviderCredentialStore.class);
		when(credentials.get(AiProvider.OPENAI)).thenReturn("test-api-key");
		var service = new NoteGenerationService(builder, JsonMapper.builder().build(), credentials);

		server.expect(requestTo("https://api.openai.com/v1/chat/completions"))
			.andExpect(header("Authorization", "Bearer test-api-key"))
			.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
			.andRespond(withSuccess("""
				{
				  "choices": [{
				    "message": {
				      "content": "{\\"title\\":\\"JIT compilation\\",\\"explanation\\":\\"Frequently used code can be compiled at runtime.\\",\\"keyPoints\\":[\\"It can improve runtime performance.\\",\\" \\" ]}"
				    }
				  }]
				}
				""", MediaType.APPLICATION_JSON));

		var note = service.generate(request("OPENAI", "gpt-4.1-mini"));

		assertThat(note.title()).isEqualTo("JIT compilation");
		assertThat(note.startTimestampSeconds()).isEqualTo(90);
		assertThat(note.keyPoints()).containsExactly("It can improve runtime performance.");
		server.verify();
	}

	@Test
	void generatesANoteThroughAnthropicMessages() {
		var builder = RestClient.builder();
		var server = MockRestServiceServer.bindTo(builder).build();
		var credentials = mock(ProviderCredentialStore.class);
		when(credentials.get(AiProvider.ANTHROPIC)).thenReturn("test-api-key");
		var service = new NoteGenerationService(builder, JsonMapper.builder().build(), credentials);

		server.expect(requestTo("https://api.anthropic.com/v1/messages"))
			.andExpect(header("x-api-key", "test-api-key"))
			.andExpect(header("anthropic-version", "2023-06-01"))
			.andRespond(withSuccess("""
				{"content":[{"type":"text","text":"{\\"title\\":\\"JIT\\",\\"explanation\\":\\"Runtime compilation\\",\\"keyPoints\\":[]}"}]}
				""", MediaType.APPLICATION_JSON));

		assertThat(service.generate(request("ANTHROPIC", "claude-sonnet-4-5")).title()).isEqualTo("JIT");
		server.verify();
	}

	@Test
	void generatesANoteThroughGeminiGenerateContent() {
		var builder = RestClient.builder();
		var server = MockRestServiceServer.bindTo(builder).build();
		var credentials = mock(ProviderCredentialStore.class);
		when(credentials.get(AiProvider.GEMINI)).thenReturn("test-api-key");
		var service = new NoteGenerationService(builder, JsonMapper.builder().build(), credentials);

		server.expect(requestTo("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent"))
			.andExpect(header("x-goog-api-key", "test-api-key"))
			.andRespond(withSuccess("""
				{"candidates":[{"content":{"parts":[{"text":"{\\"title\\":\\"JIT\\",\\"explanation\\":\\"Runtime compilation\\",\\"keyPoints\\":[]}"}]}}]}
				""", MediaType.APPLICATION_JSON));

		assertThat(service.generate(request("GEMINI", "models/gemini-3.5-flash")).title()).isEqualTo("JIT");
		server.verify();
	}

	@Test
	void transcribesRecordedAudioThroughOpenAi() {
		var builder = RestClient.builder();
		var server = MockRestServiceServer.bindTo(builder).build();
		var credentials = mock(ProviderCredentialStore.class);
		when(credentials.get(AiProvider.OPENAI)).thenReturn("test-api-key");
		var service = new NoteGenerationService(builder, JsonMapper.builder().build(), credentials);

		server.expect(requestTo("https://api.openai.com/v1/audio/transcriptions"))
			.andExpect(header("Authorization", "Bearer test-api-key"))
			.andExpect(content().contentTypeCompatibleWith(MediaType.MULTIPART_FORM_DATA))
			.andRespond(withSuccess("{\"text\":\"A short course transcript.\"}", MediaType.APPLICATION_JSON));

		assertThat(service.transcribeAudio("AQID")).isEqualTo("A short course transcript.");
		server.verify();
	}

	@Test
	void listsOnlyTextGenerationModelsForOpenAi() {
		var builder = RestClient.builder();
		var server = MockRestServiceServer.bindTo(builder).build();
		var credentials = mock(ProviderCredentialStore.class);
		when(credentials.get(AiProvider.OPENAI)).thenReturn("test-api-key");
		var service = new NoteGenerationService(builder, JsonMapper.builder().build(), credentials);

		server.expect(requestTo("https://api.openai.com/v1/models"))
			.andRespond(withSuccess("""
				{"data":[{"id":"whisper-1"},{"id":"gpt-4.1-mini"},{"id":"text-embedding-3-small"}]}
				""", MediaType.APPLICATION_JSON));

		assertThat(service.listModels(AiProvider.OPENAI)).containsExactly("gpt-4.1-mini");
		server.verify();
	}

	@Test
	void listsAnthropicModels() {
		var builder = RestClient.builder();
		var server = MockRestServiceServer.bindTo(builder).build();
		var credentials = mock(ProviderCredentialStore.class);
		when(credentials.get(AiProvider.ANTHROPIC)).thenReturn("test-api-key");
		var service = new NoteGenerationService(builder, JsonMapper.builder().build(), credentials);

		server.expect(requestTo("https://api.anthropic.com/v1/models?limit=1000"))
			.andRespond(withSuccess("""
				{"data":[{"id":"claude-sonnet-test"},{"id":"claude-haiku-test"}]}
				""", MediaType.APPLICATION_JSON));

		assertThat(service.listModels(AiProvider.ANTHROPIC)).containsExactly("claude-sonnet-test", "claude-haiku-test");
		server.verify();
	}

	@Test
	void listsOnlyGenerationCapableGeminiModels() {
		var builder = RestClient.builder();
		var server = MockRestServiceServer.bindTo(builder).build();
		var credentials = mock(ProviderCredentialStore.class);
		when(credentials.get(AiProvider.GEMINI)).thenReturn("test-api-key");
		var service = new NoteGenerationService(builder, JsonMapper.builder().build(), credentials);

		server.expect(requestTo("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000"))
			.andRespond(withSuccess("""
				{"models":[
				  {"name":"models/gemini-2.5-pro","supportedGenerationMethods":["generateContent"]},
				  {"name":"models/gemini-2.5-flash-preview-tts","supportedGenerationMethods":["generateContent"]},
				  {"name":"models/gemini-2.5-flash","supportedGenerationMethods":["generateContent"]},
				  {"name":"models/gemini-embedding","supportedGenerationMethods":["embedContent"]}
				]}
				""", MediaType.APPLICATION_JSON));

		assertThat(service.listModels(AiProvider.GEMINI))
			.containsExactly("models/gemini-2.5-flash", "models/gemini-2.5-pro");
		server.verify();
	}

	@Test
	void generatesCourseSummaryFromFullNotes() {
		var builder = RestClient.builder();
		var server = MockRestServiceServer.bindTo(builder).build();
		var credentials = mock(ProviderCredentialStore.class);
		when(credentials.get(AiProvider.OPENAI)).thenReturn("test-api-key");
		var service = new NoteGenerationService(builder, JsonMapper.builder().build(), credentials);

		server.expect(requestTo("https://api.openai.com/v1/chat/completions"))
			.andExpect(header("Authorization", "Bearer test-api-key"))
			.andRespond(withSuccess("""
				{
				  "choices": [{
				    "message": {
				      "content": "{\\"title\\":\\"EC2 Architecture\\",\\"executiveSummary\\":\\"EC2 provides scalable compute.\\",\\"coreThemes\\":[\\"Virtualization\\"],\\"keyTakeaways\\":[\\"Pay for what you use\\"],\\"reviewQuestions\\":[\\"What is an instance?\\"]}"
				    }
				  }]
				}
				""", MediaType.APPLICATION_JSON));

		var summary = service.generateSummary(new GenerateSummaryRequest(
			"OPENAI",
			"gpt-4.1-mini",
			"Amazon EC2",
			"https://skillbuilder.aws/example",
			"## [0:00] Intro\nEC2 intro text\n\n## [1:00] Hypervisor\nHypervisor isolation"));

		assertThat(summary.title()).isEqualTo("EC2 Architecture");
		assertThat(summary.executiveSummary()).isEqualTo("EC2 provides scalable compute.");
		assertThat(summary.coreThemes()).containsExactly("Virtualization");
		assertThat(summary.keyTakeaways()).containsExactly("Pay for what you use");
		assertThat(summary.formattedMarkdown()).contains("## Executive Summary");
		server.verify();
	}

	@Test
	void answersUserQuestionAndGeneratesSupplementNoteThroughOpenAi() {
		var builder = RestClient.builder();
		var server = MockRestServiceServer.bindTo(builder).build();
		var credentials = mock(ProviderCredentialStore.class);
		when(credentials.get(AiProvider.OPENAI)).thenReturn("test-api-key");
		var service = new NoteGenerationService(builder, JsonMapper.builder().build(), credentials);

		server.expect(requestTo("https://api.openai.com/v1/chat/completions"))
			.andExpect(header("Authorization", "Bearer test-api-key"))
			.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
			.andRespond(withSuccess("""
				{
				  "choices": [{
				    "message": {
				      "content": "{\\"title\\":\\"Thread Comparison: Java vs Go\\",\\"explanation\\":\\"Java uses kernel threads and virtual threads, whereas Go uses goroutines scheduled via M:N runtime.\\",\\"keyPoints\\":[\\"Goroutines start at 2KB stack.\\",\\"Java Virtual Threads mount on carrier threads.\\"]}"
				    }
				  }]
				}
				""", MediaType.APPLICATION_JSON));

		var note = service.askNote(new AskNoteRequest(
			"OPENAI",
			"gpt-4.1-mini",
			"Concurrency Course",
			"https://youtube.com/watch?v=123",
			"Compare Java and Go thread system",
			"Existing notes about threads",
			120L));

		assertThat(note.title()).isEqualTo("Thread Comparison: Java vs Go");
		assertThat(note.startTimestampSeconds()).isEqualTo(120L);
		assertThat(note.keyPoints()).hasSize(2);
		server.verify();
	}

	private GenerateNoteRequest request(String provider, String model) {
		return new GenerateNoteRequest(
			provider,
			model,
			"Java lecture",
			"https://www.youtube.com/watch?v=example",
			90,
			"Frequently used code can be compiled at runtime.");
	}
}
