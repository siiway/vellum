using System;
using System.Collections.Generic;
using System.Linq;

namespace Vellum.Demo;

// <region name="repos">
public record RepoConfig(
    string Slug,
    string Source,
    string DocsRoot,
    string DisplayName,
    string? Owner = null,
    string? Repo = null,
    string? Branch = null);
// </region>

public static class Sources
{
    // <region name="resolve">
    public static async Task<string?> ResolveAsync(RepoConfig repo, string path)
    {
        return repo.Source switch
        {
            "github" => await FetchGitHubAsync(repo.Owner!, repo.Repo!, repo.Branch!, path),
            "local"  => await FetchLocalAsync(repo.Slug, path),
            _        => throw new ArgumentException($"unknown source: {repo.Source}"),
        };
    }
    // </region>

    private static Task<string?> FetchGitHubAsync(string owner, string repo, string branch, string path) =>
        Task.FromResult<string?>(null);

    private static Task<string?> FetchLocalAsync(string slug, string path) =>
        Task.FromResult<string?>(null);
}

public static class Program
{
    public static void Main()
    {
        var repos = new List<RepoConfig>
        {
            new("prism",    "github", "docs", "Prism",    "siiway", "prism",   "main"),
            new("glint",    "github", "docs", "Glint",    "siiway", "glint",   "main"),
            new("handbook", "local",  "",     "Handbook"),
        };

        foreach (var r in repos.OrderBy(r => r.Slug))
        {
            Console.WriteLine($"{r.Slug,-10} {r.Source,-6} {r.DisplayName}");
        }
    }
}
