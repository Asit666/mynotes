package com.aivideonotes.api.web;

import com.aivideonotes.api.notes.ProviderConfigurationException;
import com.aivideonotes.api.notes.ProviderRequestException;
import com.aivideonotes.api.notes.InvalidProviderException;
import com.aivideonotes.api.notes.InvalidAudioException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {

	private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

	@ExceptionHandler(MethodArgumentNotValidException.class)
	public ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException exception) {
		var fieldError = exception.getBindingResult().getFieldErrors().stream().findFirst();
		var message = fieldError
			.map(error -> error.getField() + ": " + error.getDefaultMessage())
			.orElse("The request is invalid.");
		log.warn("Validation error: {}", message);
		return ResponseEntity.badRequest().body(new ApiError(message));
	}

	@ExceptionHandler(ProviderConfigurationException.class)
	public ResponseEntity<ApiError> handleMissingProvider(ProviderConfigurationException exception) {
		log.warn("Provider configuration error: {}", exception.getMessage());
		return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
			.body(new ApiError(exception.getMessage()));
	}

	@ExceptionHandler(InvalidProviderException.class)
	public ResponseEntity<ApiError> handleInvalidProvider(InvalidProviderException exception) {
		log.warn("Invalid provider: {}", exception.getMessage());
		return ResponseEntity.badRequest().body(new ApiError(exception.getMessage()));
	}

	@ExceptionHandler(InvalidAudioException.class)
	public ResponseEntity<ApiError> handleInvalidAudio(InvalidAudioException exception) {
		log.warn("Invalid audio: {}", exception.getMessage());
		return ResponseEntity.badRequest().body(new ApiError(exception.getMessage()));
	}

	@ExceptionHandler(ProviderRequestException.class)
	public ResponseEntity<ApiError> handleProviderFailure(ProviderRequestException exception) {
		log.error("AI Provider failure: {}", exception.getMessage(), exception);
		return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
			.body(new ApiError(exception.getMessage()));
	}

	@ExceptionHandler(Exception.class)
	public ResponseEntity<ApiError> handleGenericException(Exception exception) {
		log.error("Unhandled API error: {}", exception.getMessage(), exception);
		var msg = exception.getMessage() != null && !exception.getMessage().isBlank()
			? exception.getMessage()
			: "An unexpected error occurred.";
		return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
			.body(new ApiError(msg));
	}
}
