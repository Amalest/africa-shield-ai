import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/env.dart';

/// Result of requesting a verification code: either it was actually sent
/// by SMS, or (no Africa's Talking account configured on the backend)
/// the code comes back directly in the response so testing isn't blocked
/// — same "never fake success, just say what's really happening" pattern
/// `PushService`/`LocationService` use.
class CodeRequestResult {
  const CodeRequestResult({required this.ok, this.simulatedCode});

  final bool ok;

  /// Non-null only when the backend couldn't actually send an SMS and
  /// returned the code directly instead — show it to the user with a
  /// "for testing" caveat, never silently.
  final String? simulatedCode;
}

/// Registers/unregisters a phone number for SMS/voice flood alerts —
/// the smartphone-app equivalent of the USSD "Subscribe to alerts" menu.
///
/// Both directions now require a one-time verification code (the backend
/// used to let anyone subscribe *or unsubscribe* any phone number with no
/// proof of ownership — fixed server-side, and this class's two-step
/// shape mirrors that): request a code, then confirm with it. Mirrors
/// `PushService`'s `enable`/`disable` naming so the SMS toggle in
/// `AlertChannelsScreen` reads the same way the "Mobile App" toggle does.
class SubscriberService {
  Future<CodeRequestResult> requestCode(String phoneNumber) async {
    try {
      final uri = Uri.parse('${Env.apiBaseUrl}/api/subscribers/verify/request');
      final response = await http
          .post(
            uri,
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'phone_number': phoneNumber}),
          )
          .timeout(const Duration(seconds: 10));
      if (response.statusCode != 202) return const CodeRequestResult(ok: false);
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      return CodeRequestResult(ok: true, simulatedCode: body['simulated'] == true ? body['code'] as String? : null);
    } catch (_) {
      return const CodeRequestResult(ok: false);
    }
  }

  Future<bool> enable(String phoneNumber, String locationName, String code) async {
    try {
      final uri = Uri.parse('${Env.apiBaseUrl}/api/subscribers');
      final response = await http
          .post(
            uri,
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'phone_number': phoneNumber, 'location_name': locationName, 'code': code}),
          )
          .timeout(const Duration(seconds: 10));
      return response.statusCode == 201;
    } catch (_) {
      return false;
    }
  }

  Future<bool> disable(String phoneNumber, String code) async {
    try {
      final uri = Uri.parse('${Env.apiBaseUrl}/api/subscribers/${Uri.encodeComponent(phoneNumber)}')
          .replace(queryParameters: {'code': code});
      final response = await http.delete(uri).timeout(const Duration(seconds: 10));
      return response.statusCode == 200;
    } catch (_) {
      return false;
    }
  }
}
