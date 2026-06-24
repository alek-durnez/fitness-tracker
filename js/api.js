const GitHubAPI = {
    config: { user: "", repo: "", token: "" },
    fileSha: null,

    init(configData) {
        this.config = configData;
    },

    async executeRequest(method, payload) {
        const cleanToken = this.config.token.trim();
        const authHeader = cleanToken.startsWith("ghp_") ? `token ${cleanToken}` : cleanToken;
        const url = `https://api.github.com/repos/${this.config.user.trim()}/${this.config.repo.trim()}/contents/gym-data.json`;

        return fetch(url, {
            method: method,
            headers: {
                "Authorization": authHeader,
                "Accept": "application/vnd.github.v3+json",
                "Content-Type": "application/json"
            },
            body: payload ? JSON.stringify(payload) : null,
            cache: "no-store"
        });
    },

    async fetchDisconnect() {
        if (!this.config.user || !this.config.repo || !this.config.token) return null;
        return this.executeRequest("GET");
    }
};