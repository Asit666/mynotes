package com.aivideonotes.api.web;

import com.aivideonotes.api.notes.ProviderConfigurationException;
import com.aivideonotes.api.notes.ProviderRequestException;
import com.aivideonotes.api.notes.InvalidProviderException;
import com.aivideonotes.api.notes.InvalidAudioException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {

	@ExceptionHandler(MethodArgumentNotValidException.class)
	public ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException exception) {
		var fieldError = exception.getBindingResult().getFieldErrors().stream().findFirst();
		var message = fieldError
			.map(error -> error.getField() + ": " + error.getDefaultMessage())
			.orElse("The request is invalid.");
		return ResponseEntity.badRequest().body(new ApiError(message));
	}

	@ExceptionHandler(ProviderConfigurationException.class)
	public ResponseEntity<ApiError> handleMissingProvider(ProviderConfigurationException exception) {
		return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
			.body(new ApiError(exception.getMessage()));
	}

	@ExceptionHandler(InvalidProviderException.class)
	public ResponseEntity<ApiError> handleInvalidProvider(InvalidProviderException exception) {
		return ResponseEntity.badRequest().body(new ApiError(exception.getMessage()));
	}

	@ExceptionHandler(InvalidAudioException.class)
	public ResponseEntity<ApiError> handleInvalidAudio(InvalidAudioException exception) {
		return ResponseEntity.badRequest().body(new ApiError(exception.getMessage()));
	}

	@ExceptionHandler(ProviderRequestException.class)
	public ResponseEntity<ApiError> handleProviderFailure(ProviderRequestException exception) {
		return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
			.body(new ApiError(exception.getMessage()));
	}
}
