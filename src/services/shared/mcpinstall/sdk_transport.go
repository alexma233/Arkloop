package mcpinstall

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"

	sdkmcp "github.com/modelcontextprotocol/go-sdk/mcp"
	sdkauth "github.com/modelcontextprotocol/go-sdk/auth"

	sharedmcpoauth "arkloop/services/shared/mcpoauth"

	"golang.org/x/oauth2"
)

// BuildCommandTransport creates an SDK CommandTransport from ServerConfig.
// The subprocess always inherits the parent environment with server.Env overrides.
func BuildCommandTransport(server ServerConfig) *sdkmcp.CommandTransport {
	cmd := exec.Command(server.Command, server.Args...)
	if server.Cwd != nil {
		cmd.Dir = *server.Cwd
	}
	cmd.Env = buildInheritedEnv(server.Env)
	return &sdkmcp.CommandTransport{Command: cmd}
}

// BuildStreamableTransport creates an SDK StreamableClientTransport from ServerConfig.
// httpClient may be nil (defaults to http.DefaultClient).
// onOAuthRefresh is called after token refresh; may be nil.
func BuildStreamableTransport(server ServerConfig, httpClient *http.Client, onOAuthRefresh func(updated *sharedmcpoauth.AuthState)) *sdkmcp.StreamableClientTransport {
	client := httpClient
	if client == nil {
		client = http.DefaultClient
	}

	// Wrap transport to inject static headers
	if len(server.Headers) > 0 {
		client = injectHeaders(client, server.Headers)
	}

	// Build OAuth handler if OAuth state exists
	var oauthHandler sdkauth.OAuthHandler
	if server.OAuth != nil {
		oauthHandler = &ArkloopOAuthHandler{
			OAuth:     server.OAuth,
			HTTPDoer:  client,
			OnRefresh: onOAuthRefresh,
		}
	}

	return &sdkmcp.StreamableClientTransport{
		Endpoint:    server.URL,
		HTTPClient:  client,
		OAuthHandler: oauthHandler,
	}
}

func buildInheritedEnv(overrides map[string]string) []string {
	env := os.Environ()
	for key, value := range overrides {
		prefix := key + "="
		// Remove existing entry for the key
		filtered := env[:0]
		for _, entry := range env {
			if !strings.HasPrefix(entry, prefix) {
				filtered = append(filtered, entry)
			}
		}
		env = append(filtered, fmt.Sprintf("%s=%s", key, value))
	}
	return env
}

func injectHeaders(client *http.Client, headers map[string]string) *http.Client {
	transport := client.Transport
	if transport == nil {
		transport = http.DefaultTransport
	}
	return &http.Client{
		Transport:    &HeaderInjectingRoundTripper{Base: transport, Headers: headers},
		CheckRedirect: client.CheckRedirect,
		Jar:          client.Jar,
		Timeout:      client.Timeout,
	}
}

// HeaderInjectingRoundTripper adds static headers to every outbound request.
type HeaderInjectingRoundTripper struct {
	Base    http.RoundTripper
	Headers map[string]string
}

func (t *HeaderInjectingRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	for key, value := range t.Headers {
		if strings.TrimSpace(key) == "" || strings.TrimSpace(value) == "" {
			continue
		}
		req.Header.Set(key, value)
	}
	return t.Base.RoundTrip(req)
}

// ArkloopOAuthHandler implements auth.OAuthHandler, bridging our mcpoauth.AuthState
// to the SDK's OAuth interface.
type ArkloopOAuthHandler struct {
	OAuth     *sharedmcpoauth.AuthState
	HTTPDoer  sharedmcpoauth.HTTPDoer
	OnRefresh func(updated *sharedmcpoauth.AuthState)
	mu        sync.Mutex
}

func (h *ArkloopOAuthHandler) TokenSource(ctx context.Context) (oauth2.TokenSource, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.OAuth == nil {
		return nil, nil
	}

	tokens := h.OAuth.Tokens
	// If access token is valid, return it directly
	if strings.TrimSpace(tokens.AccessToken) != "" && !sharedmcpoauth.TokenExpiredSoon(tokens, 0) {
		return oauth2.StaticTokenSource(&oauth2.Token{
			AccessToken: strings.TrimSpace(tokens.AccessToken),
			TokenType:   "Bearer",
			Expiry:      tokens.ExpiresAt,
		}), nil
	}

	// Try to refresh
	if strings.TrimSpace(tokens.RefreshToken) == "" {
		return nil, nil
	}

	refreshed, err := sharedmcpoauth.RefreshAuthorization(ctx, h.HTTPDoer, h.OAuth.Discovery, h.OAuth.Client, tokens.RefreshToken)
	if err != nil {
		return nil, fmt.Errorf("mcp oauth: refresh failed: %w", err)
	}

	h.OAuth.Tokens = refreshed
	if h.OnRefresh != nil {
		h.OnRefresh(h.OAuth)
	}

	return oauth2.StaticTokenSource(&oauth2.Token{
		AccessToken: strings.TrimSpace(refreshed.AccessToken),
		TokenType:   "Bearer",
		Expiry:      refreshed.ExpiresAt,
	}), nil
}

func (h *ArkloopOAuthHandler) Authorize(ctx context.Context, req *http.Request, resp *http.Response) error {
	// Close the response body as required by the interface contract
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	// Full OAuth authorization flow is handled on the API side.
	// Worker returns an error to signal that user intervention is needed.
	return fmt.Errorf("mcp oauth: authorization required (flow not available on worker)")
}
