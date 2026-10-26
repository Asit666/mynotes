package com.aivideonotes.api.config;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Arrays;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class ApiConfiguration {

	@Bean
	RestClient.Builder aiProviderRestClientBuilder() {
		var client = HttpClient.newBuilder()
			.connectTimeout(Duration.ofSeconds(5))
			.build();
		var requestFactory = new JdkClientHttpRequestFactory(client);
		requestFactory.setReadTimeout(Duration.ofSeconds(45));
		return RestClient.builder().requestFactory(requestFactory);
	}

	@Bean
	WebMvcConfigurer corsConfiguration(
			@Value("${AI_VIDEO_NOTES_ALLOWED_ORIGIN_PATTERNS:http://localhost:5173,http://127.0.0.1:5173,chrome-extension://*}")
			String allowedOriginPatterns) {
		var origins = Arrays.stream(allowedOriginPatterns.split(","))
			.map(String::trim)
			.filter(origin -> !origin.isEmpty())
			.toArray(String[]::new);

		return new WebMvcConfigurer() {
			@Override
			public void addCorsMappings(CorsRegistry registry) {
				registry.addMapping("/api/**")
					.allowedOriginPatterns("*")
					.allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
					.allowedHeaders("*")
					.allowCredentials(false)
					.maxAge(3600);
			}
		};
	}
}
