import 'package:flutter/material.dart';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../providers/onboarding_provider.dart';
import '../../providers/region_provider.dart';
import '../../providers/region_selection.dart';
import '../../providers/settings_provider.dart';
import '../../services/push_service.dart';
import '../../services/subscriber_service.dart';
import '../../theme/app_theme.dart';

/// Matches the Figma "Alert Channels" screen. SMS (via `SubscriberService`)
/// and "Mobile App" (real push notifications, via `PushService`) are real;
/// WhatsApp and USSD are still switches with nothing behind them yet — see
/// `todo.md`.
class AlertChannelsScreen extends StatefulWidget {
  const AlertChannelsScreen({super.key});

  @override
  State<AlertChannelsScreen> createState() => _AlertChannelsScreenState();
}

class _AlertChannelsScreenState extends State<AlertChannelsScreen> {
  static const _mobileAppKey = 'channel_mobile_app_v1';
  static const _whatsappKey = 'channel_whatsapp_v1';
  static const _smsKey = 'channel_sms_v1';
  static const _ussdKey = 'channel_ussd_v1';

  late final _pushService = PushService(
    onMessage: () => context.read<RegionProvider>().load(),
  );
  final _subscriberService = SubscriberService();

  bool _mobileApp = false;
  bool _whatsapp = false;
  bool _sms = true;
  bool _ussd = false;
  bool _loaded = false;
  bool _togglingPush = false;
  bool _togglingSms = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      _mobileApp = prefs.getBool(_mobileAppKey) ?? false;
      _whatsapp = prefs.getBool(_whatsappKey) ?? false;
      // SMS's stored preference is just a UI hint now, not proof of a real
      // registration — verifying a phone number needs the user present
      // (see _onToggleSms), so this screen can no longer silently
      // (re-)register in the background the way it used to. Default to
      // false rather than true: an unverified "on" would be misleading.
      _sms = prefs.getBool(_smsKey) ?? false;
      _ussd = prefs.getBool(_ussdKey) ?? false;
      _loaded = true;
    });
  }

  Future<void> _save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_mobileAppKey, _mobileApp);
    await prefs.setBool(_whatsappKey, _whatsapp);
    await prefs.setBool(_smsKey, _sms);
    await prefs.setBool(_ussdKey, _ussd);
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(AppLocalizations.of(context)!.preferencesSaved)));
  }

  /// Unlike the other three toggles (only persisted when "Save
  /// Preferences" is tapped), push takes effect immediately — it's a
  /// real network registration/unregistration, not just a stored
  /// preference, so "on" in the UI should always mean "actually
  /// registered," never "will register once you hit Save."
  Future<void> _onToggleMobileApp(bool value) async {
    final l10n = AppLocalizations.of(context)!;
    setState(() => _togglingPush = true);

    if (value) {
      final regionProvider = context.read<RegionProvider>();
      final settings = context.read<SettingsProvider>();
      final onboarding = context.read<OnboardingProvider>();
      final picked = pickMyRegion(regions: regionProvider.regions, settings: settings, onboarding: onboarding);
      if (picked == null || !picked.isRealMatch) {
        if (!mounted) return;
        setState(() => _togglingPush = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l10n.pushNoRegionYet)));
        return;
      }
      final ok = await _pushService.enable(picked.region.locationName);
      if (!mounted) return;
      setState(() => _togglingPush = false);
      if (!ok) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l10n.pushUnavailable)));
        return;
      }
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_mobileAppKey, true);
      if (!mounted) return;
      setState(() => _mobileApp = true);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l10n.pushEnabled)));
    } else {
      await _pushService.disable();
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_mobileAppKey, false);
      if (!mounted) return;
      setState(() {
        _mobileApp = false;
        _togglingPush = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l10n.pushDisabled)));
    }
  }

  /// Same immediate-effect contract as `_onToggleMobileApp`: a real
  /// registration/unregistration against `POST /api/subscribers`, not
  /// just a stored preference. Needs a phone number from onboarding
  /// (Settings > Location, same screen that captures it) — without one
  /// there's nothing to register, so this refuses rather than silently
  /// pretending SMS is on.
  ///
  /// Both directions now require verifying phone-number ownership first
  /// (the backend rejects an unverified subscribe *or* unsubscribe) — the
  /// server used to let anyone add or remove any phone number with no
  /// proof at all, which for *removing* someone from real flood alerts is
  /// about as bad an outcome as this system could produce. So this always
  /// requests a code and prompts for it before calling
  /// `enable`/`disable`, even when turning SMS *off*.
  Future<void> _onToggleSms(bool value) async {
    final l10n = AppLocalizations.of(context)!;
    final onboarding = context.read<OnboardingProvider>();
    final phoneNumber = onboarding.phoneNumber;
    if (phoneNumber == null || phoneNumber.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l10n.smsNoPhoneYet)));
      return;
    }

    String? regionLocationName;
    if (value) {
      final regionProvider = context.read<RegionProvider>();
      final settings = context.read<SettingsProvider>();
      final picked = pickMyRegion(regions: regionProvider.regions, settings: settings, onboarding: onboarding);
      if (picked == null || !picked.isRealMatch) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l10n.smsNoRegionYet)));
        return;
      }
      regionLocationName = picked.region.locationName;
    }

    setState(() => _togglingSms = true);
    final codeResult = await _subscriberService.requestCode(phoneNumber);
    if (!mounted) return;
    if (!codeResult.ok) {
      setState(() => _togglingSms = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l10n.smsCodeRequestFailed)));
      return;
    }

    final code = await _promptForCode(phoneNumber: phoneNumber, simulatedCode: codeResult.simulatedCode);
    if (!mounted) return;
    if (code == null) {
      setState(() => _togglingSms = false);
      return;
    }

    if (value) {
      final ok = await _subscriberService.enable(phoneNumber, regionLocationName!, code);
      if (!mounted) return;
      setState(() {
        _togglingSms = false;
        if (ok) _sms = true;
      });
      if (!ok) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l10n.smsRegistrationFailed)));
        return;
      }
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_smsKey, true);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l10n.smsEnabled)));
    } else {
      final ok = await _subscriberService.disable(phoneNumber, code);
      if (!mounted) return;
      setState(() => _togglingSms = false);
      if (!ok) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l10n.smsRegistrationFailed)));
        return;
      }
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_smsKey, false);
      if (!mounted) return;
      setState(() => _sms = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l10n.smsDisabled)));
    }
  }

  /// Prompts for the 6-digit code just requested. Pre-fills it when the
  /// backend returned one directly (`simulatedCode` — SMS isn't
  /// configured server-side, same "shown here for testing only" honesty
  /// pattern as the backend itself uses) so testing this flow doesn't
  /// require a real Africa's Talking account; otherwise starts empty,
  /// since a real code only exists in the SMS the user just received.
  /// Returns `null` if the user cancels.
  Future<String?> _promptForCode({required String phoneNumber, String? simulatedCode}) {
    final l10n = AppLocalizations.of(context)!;
    final controller = TextEditingController(text: simulatedCode ?? '');
    return showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.smsCodeDialogTitle),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l10n.smsCodeDialogBody(phoneNumber)),
            if (simulatedCode != null) ...[
              const SizedBox(height: 8),
              Text(l10n.smsCodeSimulatedNote, style: const TextStyle(color: AppColors.riskMedium, fontSize: 12)),
            ],
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              keyboardType: TextInputType.number,
              maxLength: 6,
              decoration: InputDecoration(hintText: l10n.smsCodeHint),
              autofocus: simulatedCode == null,
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, null), child: Text(l10n.cancelButton)),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, controller.text.trim()),
            child: Text(l10n.smsCodeSubmitButton),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (!_loaded) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.alertChannelsAppBarTitle)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(l10n.howWouldYouLikeAlerts,
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
          Text(l10n.preferredChannelsNote,
              style: const TextStyle(color: AppColors.inkSoft)),
          const SizedBox(height: 16),
          _ChannelTile(
            icon: Icons.phone_iphone,
            title: l10n.mobileAppChannelTitle,
            subtitle: l10n.mobileAppChannelSubtitle,
            enabled: !_togglingPush,
            note: l10n.pushNotWiredNote,
            value: _mobileApp,
            onChanged: _onToggleMobileApp,
          ),
          _ChannelTile(
            icon: Icons.chat_bubble_outline,
            title: l10n.whatsappChannelTitle,
            subtitle: l10n.whatsappChannelSubtitle,
            enabled: false,
            note: l10n.notBuiltNote,
            value: _whatsapp,
            onChanged: (v) => setState(() => _whatsapp = v),
          ),
          _ChannelTile(
            icon: Icons.sms_outlined,
            title: l10n.smsChannelTitle,
            subtitle: l10n.smsChannelSubtitle,
            enabled: !_togglingSms,
            note: l10n.smsRealNote,
            value: _sms,
            onChanged: _onToggleSms,
          ),
          _ChannelTile(
            icon: Icons.dialpad,
            title: l10n.ussdChannelTitle,
            subtitle: l10n.ussdChannelSubtitle,
            enabled: false,
            note: l10n.ussdNote,
            value: _ussd,
            onChanged: (v) => setState(() => _ussd = v),
          ),
          const SizedBox(height: 12),
          Card(
            color: AppColors.background,
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(l10n.noSmartphoneTitle, style: const TextStyle(fontWeight: FontWeight.w800)),
                  const SizedBox(height: 4),
                  Text(
                    l10n.noSmartphoneBody,
                    style: const TextStyle(color: AppColors.inkSoft),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 20),
          FilledButton(onPressed: _save, child: Text(l10n.savePreferences)),
        ],
      ),
    );
  }
}

class _ChannelTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final String note;
  final bool enabled;
  final bool value;
  final ValueChanged<bool> onChanged;

  const _ChannelTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.note,
    required this.enabled,
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          child: Row(
            children: [
              Icon(icon, color: AppColors.navy),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
                    Text(subtitle, style: const TextStyle(color: AppColors.inkSoft, fontSize: 12.5)),
                    Text(note,
                        style: TextStyle(
                            color: enabled ? AppColors.riskLow : AppColors.riskMedium,
                            fontSize: 11,
                            fontWeight: FontWeight.w700)),
                  ],
                ),
              ),
              Switch(value: value, onChanged: enabled ? onChanged : null),
            ],
          ),
        ),
      ),
    );
  }
}
