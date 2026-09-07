import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart' as http_parser;

import '../config/env.dart';
import '../models/alert.dart';
import '../models/hazard_report.dart';
import '../models/region.dart';

enum ApiErrorKind { network, server }

class ApiException implements Exception {
  final ApiErrorKind kind;
  final String debugDetail;
  ApiException(this.kind, this.debugDetail);

  /// Technical, English-only detail (e.g. the exact status code and
  /// URL) — for logs/debugging, not the UI.
  @override
  String toString() => debugDetail;

  /// User-facing, translated message. Exceptions are thrown from this
  /// service class with no `BuildContext` to localize with directly, so
  /// callers (which do have one) resolve the actual string via this
  /// method instead of showing [toString]'s raw English detail.
  String localizedMessage(AppLocalizations l10n) {
    switch (kind) {
      case ApiErrorKind.network:
        return l10n.apiErrorNetwork;
      case ApiErrorKind.server:
        return l10n.apiErrorServer;
    }
  }
}

/// Thin wrapper over the real backend. Every method here hits an endpoint
/// that's already built and tested — see docs/api-contract.md. Nothing in
/// this file is a mock; if the backend isn't reachable, callers get a
/// real ApiException and should fall back to CacheService's last-known data.
class ApiService {
  final http.Client _client;
  final String baseUrl;

  ApiService({http.Client? client, String? baseUrl})
      : _client = client ?? http.Client(),
        baseUrl = baseUrl ?? Env.apiBaseUrl;

  Future<List<Region>> fetchRegions() async {
    final uri = Uri.parse('$baseUrl/api/regions');
    final response = await _get(uri);
    final data = jsonDecode(response.body) as List<dynamic>;
    return data
        .map((e) => Region.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<List<AlertEvent>> fetchAlerts() async {
    final uri = Uri.parse('$baseUrl/api/alerts');
    final response = await _get(uri);
    final data = jsonDecode(response.body) as List<dynamic>;
    return data
        .map((e) => AlertEvent.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Returns the newly created report's `id`, so a follow-up
  /// [uploadHazardReportPhoto] call (if the user attached a photo) knows
  /// which report to attach it to.
  Future<String> submitHazardReport(HazardReport report) async {
    final uri = Uri.parse('$baseUrl/api/hazard-reports');
    try {
      final response = await _client
          .post(
            uri,
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode(report.toJson()),
          )
          .timeout(const Duration(seconds: 10));
      if (response.statusCode != 201) {
        throw ApiException(
          ApiErrorKind.server,
          'Backend returned ${response.statusCode} for $uri',
        );
      }
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      return data['id'] as String;
    } on ApiException {
      rethrow;
    } catch (e) {
      throw ApiException(ApiErrorKind.network, 'Could not reach the backend: $e');
    }
  }

  /// Attaches a photo to an already-created report (`POST
  /// /api/hazard-reports/{id}/photo`) — a separate call because the
  /// backend endpoint is multipart, not JSON. Takes raw bytes (not a file
  /// path) so this works on web too, where picked images have no
  /// filesystem path.
  Future<void> uploadHazardReportPhoto(
    String reportId,
    Uint8List bytes,
    String filename,
    String contentType,
  ) async {
    final uri = Uri.parse('$baseUrl/api/hazard-reports/$reportId/photo');
    try {
      final request = http.MultipartRequest('POST', uri)
        ..files.add(http.MultipartFile.fromBytes(
          'photo',
          bytes,
          filename: filename,
          contentType: http_parser.MediaType.parse(contentType),
        ));
      final streamedResponse = await _client
          .send(request)
          .timeout(const Duration(seconds: 20));
      final response = await http.Response.fromStream(streamedResponse);
      if (response.statusCode != 200) {
        throw ApiException(
          ApiErrorKind.server,
          'Backend returned ${response.statusCode} for $uri',
        );
      }
    } on ApiException {
      rethrow;
    } catch (e) {
      throw ApiException(ApiErrorKind.network, 'Could not reach the backend: $e');
    }
  }

  Future<http.Response> _get(Uri uri) async {
    try {
      final response = await _client.get(uri).timeout(
            const Duration(seconds: 10),
          );
      if (response.statusCode != 200) {
        throw ApiException(
          ApiErrorKind.server,
          'Backend returned ${response.statusCode} for $uri',
        );
      }
      return response;
    } on ApiException {
      rethrow;
    } catch (e) {
      throw ApiException(ApiErrorKind.network, 'Could not reach the backend: $e');
    }
  }
}
