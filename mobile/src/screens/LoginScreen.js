import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { colors, spacing, fonts } from '../theme';
import { apiLogin, apiRegister } from '../services/socket';

export default function LoginScreen({ onLogin }) {
  const [isRegister, setIsRegister] = useState(false);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!phone || !password) {
      Alert.alert('Erreur', 'Numéro et mot de passe requis');
      return;
    }
    setLoading(true);
    try {
      let result;
      if (isRegister) {
        result = await apiRegister(phone, password, displayName || phone);
      } else {
        result = await apiLogin(phone, password);
      }
      onLogin(result.user);
    } catch (err) {
      Alert.alert('Erreur', err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.logoCircle}>
          <Text style={styles.logoText}>B</Text>
        </View>
        <Text style={styles.title}>Buchat</Text>
        <Text style={styles.subtitle}>par Buja Online</Text>
      </View>

      {/* Form Card */}
      <View style={styles.card}>
        {/* Tabs */}
        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, !isRegister && styles.tabActive]}
            onPress={() => setIsRegister(false)}
          >
            <Text style={[styles.tabText, !isRegister && styles.tabTextActive]}>
              CONNEXION
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, isRegister && styles.tabActive]}
            onPress={() => setIsRegister(true)}
          >
            <Text style={[styles.tabText, isRegister && styles.tabTextActive]}>
              INSCRIPTION
            </Text>
          </TouchableOpacity>
        </View>

        {isRegister && (
          <TextInput
            style={styles.input}
            placeholder="Votre nom..."
            placeholderTextColor={colors.textSecondary}
            value={displayName}
            onChangeText={setDisplayName}
          />
        )}

        <TextInput
          style={styles.input}
          placeholder="Numéro de téléphone..."
          placeholderTextColor={colors.textSecondary}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
        />

        <TextInput
          style={styles.input}
          placeholder="Mot de passe..."
          placeholderTextColor={colors.textSecondary}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity
          style={styles.button}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={colors.textOnAccent} />
          ) : (
            <Text style={styles.buttonText}>
              {isRegister ? 'CRÉER MON COMPTE' : 'SE CONNECTER'}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <Text style={styles.footer}>
        © 2026 Buja Online — Bujumbura, Burundi
      </Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  logoCircle: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  logoText: {
    fontSize: 36,
    fontWeight: 'bold',
    color: colors.textOnAccent,
  },
  title: {
    fontSize: fonts.sizes.header,
    fontWeight: 'bold',
    color: colors.textOnPrimary,
  },
  subtitle: {
    fontSize: fonts.sizes.body,
    color: colors.textOnPrimary,
    opacity: 0.8,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 400,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  tabs: {
    flexDirection: 'row',
    marginBottom: spacing.lg,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  tabActive: {
    backgroundColor: colors.accent,
  },
  tabText: {
    fontSize: fonts.sizes.body,
    fontWeight: 'bold',
    color: colors.textSecondary,
  },
  tabTextActive: {
    color: colors.textOnAccent,
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.md,
    fontSize: fonts.sizes.body,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 8,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonText: {
    color: colors.textOnAccent,
    fontSize: fonts.sizes.subtitle,
    fontWeight: 'bold',
  },
  footer: {
    color: colors.textOnPrimary,
    opacity: 0.6,
    marginTop: spacing.xl,
    fontSize: fonts.sizes.small,
    textAlign: 'center',
  },
});
