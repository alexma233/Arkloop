package llm

import "testing"

func TestDetectSymptoms_OpenAIContextLengthStream200(t *testing.T) {
	rawBody := `{"type":"invalid_request_error","code":"context_length_exceeded","message":"Your input exceeds the context window of this model."}`
	syms := DetectSymptoms(SymptomMatchContext{Status: 200, RawBody: rawBody}, openAISymptoms)
	if !containsSymptom(syms, SymptomContextLengthExceeded) {
		t.Fatalf("expected context_length_exceeded, got %v", syms)
	}
}

func TestDetectSymptoms_OpenAIContextLengthFromDetailsCode(t *testing.T) {
	syms := DetectSymptoms(SymptomMatchContext{
		Status:  400,
		RawBody: "",
		Details: map[string]any{"openai_error_code": "context_length_exceeded"},
	}, openAISymptoms)
	if !containsSymptom(syms, SymptomContextLengthExceeded) {
		t.Fatalf("expected context_length_exceeded, got %v", syms)
	}
}

func TestDetectSymptoms_AnthropicNilTypeFallsBackToText(t *testing.T) {
	rawBody := `{"error":{"type":"<nil>","message":"The prompt is too long: 253897, model maximum context length: 163839"}}`
	syms := DetectSymptoms(SymptomMatchContext{
		Status:  400,
		RawBody: rawBody,
		Details: map[string]any{"anthropic_error_type": "<nil>"},
	}, anthropicSymptoms)
	if !containsSymptom(syms, SymptomContextLengthExceeded) {
		t.Fatalf("expected context_length_exceeded via text fallback, got %v", syms)
	}
}

func TestDetectSymptoms_NoFalsePositiveOnRateLimit(t *testing.T) {
	rawBody := `{"error":{"type":"rate_limit_error","message":"Rate limit exceeded"}}`
	syms := DetectSymptoms(SymptomMatchContext{
		Status:  429,
		RawBody: rawBody,
		Details: map[string]any{"openai_error_type": "rate_limit_error"},
	}, openAISymptoms)
	if containsSymptom(syms, SymptomContextLengthExceeded) {
		t.Fatalf("rate_limit must not match context_length_exceeded: %v", syms)
	}
}

func TestDetectSymptoms_NoFalsePositiveOnAuthError(t *testing.T) {
	rawBody := `{"error":{"type":"invalid_request_error","code":"invalid_api_key","message":"Invalid api key"}}`
	syms := DetectSymptoms(SymptomMatchContext{Status: 401, RawBody: rawBody}, openAISymptoms)
	if containsSymptom(syms, SymptomContextLengthExceeded) {
		t.Fatalf("auth error must not match context_length: %v", syms)
	}
}

func TestDetectSymptoms_OpenAIQuirkSymptoms(t *testing.T) {
	cases := []struct {
		name string
		body string
		want SymptomID
	}{
		{"reasoning_passback", `reasoning_content must be passed back to the API`, SymptomReasoningContentPassback},
		{"xhigh", `reasoning_effort xhigh expected low medium high`, SymptomXHighReasoningUnsupported},
		{"tool_choice", `tool_choice unsupported for this model`, SymptomToolChoiceUnsupported},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			syms := DetectSymptoms(SymptomMatchContext{Status: 400, RawBody: tc.body}, openAISymptoms)
			if !containsSymptom(syms, tc.want) {
				t.Fatalf("expected %s, got %v", tc.want, syms)
			}
		})
	}
}

func TestDetectSymptoms_AnthropicQuirkSymptoms(t *testing.T) {
	cases := []struct {
		name string
		body string
		want SymptomID
	}{
		{"unsigned", `Invalid signature in thinking block`, SymptomUnsignedThinking},
		{"temp_one", `temperature may only be set to 1 when thinking is enabled`, SymptomTempMustBeOneOnThinking},
		{"empty_text", `content in thinking mode must be passed back`, SymptomEmptyTextOnThinking},
		{"cache_control", `cache_control extra inputs are not permitted`, SymptomCacheControlRejected},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			syms := DetectSymptoms(SymptomMatchContext{Status: 400, RawBody: tc.body}, anthropicSymptoms)
			if !containsSymptom(syms, tc.want) {
				t.Fatalf("expected %s, got %v", tc.want, syms)
			}
		})
	}
}

func TestMergeSymptomsIntoDetails_DedupAndAppend(t *testing.T) {
	details := map[string]any{"symptoms": []string{"context_length_exceeded"}}
	details = MergeSymptomsIntoDetails(details, []SymptomID{SymptomContextLengthExceeded, SymptomToolChoiceUnsupported})
	out, _ := details["symptoms"].([]string)
	if len(out) != 2 || out[0] != "context_length_exceeded" || out[1] != "tool_choice_unsupported" {
		t.Fatalf("unexpected merged symptoms: %#v", out)
	}
}

func TestDetailsHaveSymptom(t *testing.T) {
	details := map[string]any{"symptoms": []string{"context_length_exceeded"}}
	if !DetailsHaveSymptom(details, SymptomContextLengthExceeded) {
		t.Fatal("must detect symptom in []string")
	}
	if DetailsHaveSymptom(details, SymptomToolChoiceUnsupported) {
		t.Fatal("unexpected positive")
	}
	anyDetails := map[string]any{"symptoms": []any{"context_length_exceeded"}}
	if !DetailsHaveSymptom(anyDetails, SymptomContextLengthExceeded) {
		t.Fatal("must detect symptom in []any")
	}
}

func containsSymptom(list []SymptomID, want SymptomID) bool {
	for _, s := range list {
		if s == want {
			return true
		}
	}
	return false
}
