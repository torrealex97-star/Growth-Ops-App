// GENERADO — no editar a mano. Fuente: OpenAPI de PostgREST (2026-09-19T07:21:22.941Z).
// Regenerar con: npm run tipos:bd  (y commitear). El test tests/esquema-tenant-invariante.test.mjs
// comprueba que este artefacto sigue fresco respecto al esquema vivo.
// Espejo exacto del esquema public de Supabase; los tipos de APP siguen en lib/types/database.ts.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type EsquemaPublico = {
  Tables: {
    Activities: {
      Row: {
        id: string | null
        contact_id: string | null
        person_id: string | null
        type: string | null
        activity_datetime: string | null
        direction: string | null
        result: string | null
        duration_min: number | string | null
        notes: string | null
        created_at: string | null
        updated_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        contact_id: string | null | undefined
        person_id: string | null | undefined
        type: string | null | undefined
        activity_datetime: string | null | undefined
        direction: string | null | undefined
        result: string | null | undefined
        duration_min: number | string | null | undefined
        notes: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        contact_id: string | undefined
        person_id: string | undefined
        type: string | undefined
        activity_datetime: string | undefined
        direction: string | undefined
        result: string | undefined
        duration_min: number | string | undefined
        notes: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    AffiliateCampaignMembers: {
      Row: {
        id: string | null
        campaign_id: string | null
        affiliate_id: string | null
        created_by: string | null
        created_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        campaign_id: string | null | undefined
        affiliate_id: string | null | undefined
        created_by: string | null | undefined
        created_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        campaign_id: string | undefined
        affiliate_id: string | undefined
        created_by: string | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    AffiliateCampaigns: {
      Row: {
        id: string | null
        name: string | null
        type: string | null
        base_url: string | null
        is_active: boolean | null
        created_by: string | null
        created_at: string | null
        updated_at: string | null
        registration_slug: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        name: string | null | undefined
        type: string | null | undefined
        base_url: string | null | undefined
        is_active: boolean | null | undefined
        created_by: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        registration_slug: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        name: string | undefined
        type: string | undefined
        base_url: string | undefined
        is_active: boolean | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        registration_slug: string | undefined
        tenant_id: string | undefined
      }
    }
    AffiliateProfiles: {
      Row: {
        user_id: string | null
        instagram: string | null
        audience_size: string | null
        niche: string | null
        source: string | null
        motivation: string | null
        extra: Json | null
        created_at: string | null
        updated_at: string | null
        tenant_id: string | null
      }
      Insert: {
        user_id: string | null | undefined
        instagram: string | null | undefined
        audience_size: string | null | undefined
        niche: string | null | undefined
        source: string | null | undefined
        motivation: string | null | undefined
        extra: Json | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        user_id: string | undefined
        instagram: string | undefined
        audience_size: string | undefined
        niche: string | undefined
        source: string | undefined
        motivation: string | undefined
        extra: Json | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    AffiliateProgramSettings: {
      Row: {
        id: number | null
        default_commission_percent: number | string | null
        program_name: string | null
        intro: string | null
        success_message: string | null
        form_fields: Json | null
        updated_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: number | null | undefined
        default_commission_percent: number | string | null | undefined
        program_name: string | null | undefined
        intro: string | null | undefined
        success_message: string | null | undefined
        form_fields: Json | null | undefined
        updated_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: number | undefined
        default_commission_percent: number | string | undefined
        program_name: string | undefined
        intro: string | undefined
        success_message: string | undefined
        form_fields: Json | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    AiBusinessFacts: {
      Row: {
        id: string | null
        tenant_id: string | null
        type: string | null
        content: string | null
        evidence: Json | null
        outcome_of: string | null
        created_by: string | null
        created_at: string | null
      }
      Insert: {
        id: string | null | undefined
        tenant_id: string | null | undefined
        type: string | null | undefined
        content: string | null | undefined
        evidence: Json | null | undefined
        outcome_of: string | null | undefined
        created_by: string | null | undefined
        created_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        type: string | undefined
        content: string | undefined
        evidence: Json | undefined
        outcome_of: string | undefined
        created_by: string | undefined
        created_at: string | undefined
      }
    }
    AiConversations: {
      Row: {
        id: string | null
        tenant_id: string | null
        user_id: string | null
        title: string | null
        screen: string | null
        created_at: string | null
        updated_at: string | null
      }
      Insert: {
        id: string | null | undefined
        tenant_id: string | null | undefined
        user_id: string | null | undefined
        title: string | null | undefined
        screen: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        user_id: string | undefined
        title: string | undefined
        screen: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    AiInsights: {
      Row: {
        id: string | null
        tenant_id: string | null
        type: string | null
        severity: string | null
        title: string | null
        summary: string | null
        evidence: Json | null
        status: string | null
        fingerprint: string | null
        period_start: string | null
        period_end: string | null
        generated_at: string | null
      }
      Insert: {
        id: string | null | undefined
        tenant_id: string | null | undefined
        type: string | null | undefined
        severity: string | null | undefined
        title: string | null | undefined
        summary: string | null | undefined
        evidence: Json | null | undefined
        status: string | null | undefined
        fingerprint: string | null | undefined
        period_start: string | null | undefined
        period_end: string | null | undefined
        generated_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        type: string | undefined
        severity: string | undefined
        title: string | undefined
        summary: string | undefined
        evidence: Json | undefined
        status: string | undefined
        fingerprint: string | undefined
        period_start: string | undefined
        period_end: string | undefined
        generated_at: string | undefined
      }
    }
    AiMessages: {
      Row: {
        id: string | null
        tenant_id: string | null
        conversation_id: string | null
        role: string | null
        content: string | null
        evidence: Json | null
        created_at: string | null
        model: string | null
        input_tokens: number | null
        output_tokens: number | null
        cache_read_tokens: number | null
        cache_write_tokens: number | null
        cost_usd: number | string | null
        latency_ms: number | null
      }
      Insert: {
        id: string | null | undefined
        tenant_id: string | null | undefined
        conversation_id: string | null | undefined
        role: string | null | undefined
        content: string | null | undefined
        evidence: Json | null | undefined
        created_at: string | null | undefined
        model: string | null | undefined
        input_tokens: number | null | undefined
        output_tokens: number | null | undefined
        cache_read_tokens: number | null | undefined
        cache_write_tokens: number | null | undefined
        cost_usd: number | string | null | undefined
        latency_ms: number | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        conversation_id: string | undefined
        role: string | undefined
        content: string | undefined
        evidence: Json | undefined
        created_at: string | undefined
        model: string | undefined
        input_tokens: number | undefined
        output_tokens: number | undefined
        cache_read_tokens: number | undefined
        cache_write_tokens: number | undefined
        cost_usd: number | string | undefined
        latency_ms: number | undefined
      }
    }
    AiToolCalls: {
      Row: {
        id: string | null
        tenant_id: string | null
        conversation_id: string | null
        message_id: string | null
        tool_name: string | null
        input: Json | null
        result_summary: string | null
        success: boolean | null
        latency_ms: number | null
        created_at: string | null
      }
      Insert: {
        id: string | null | undefined
        tenant_id: string | null | undefined
        conversation_id: string | null | undefined
        message_id: string | null | undefined
        tool_name: string | null | undefined
        input: Json | null | undefined
        result_summary: string | null | undefined
        success: boolean | null | undefined
        latency_ms: number | null | undefined
        created_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        conversation_id: string | undefined
        message_id: string | undefined
        tool_name: string | undefined
        input: Json | undefined
        result_summary: string | undefined
        success: boolean | undefined
        latency_ms: number | undefined
        created_at: string | undefined
      }
    }
    AnalyticsSessions: {
      Row: {
        id: string | null
        visitor_id: string | null
        external_session_id: string | null
        started_at: string | null
        ended_at: string | null
        landing_url: string | null
        referrer: string | null
        utm_source: string | null
        utm_medium: string | null
        utm_campaign: string | null
        utm_content: string | null
        utm_term: string | null
        gclid: string | null
        fbclid: string | null
        ttclid: string | null
        raw_parameters: Json | null
        created_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        visitor_id: string | null | undefined
        external_session_id: string | null | undefined
        started_at: string | null | undefined
        ended_at: string | null | undefined
        landing_url: string | null | undefined
        referrer: string | null | undefined
        utm_source: string | null | undefined
        utm_medium: string | null | undefined
        utm_campaign: string | null | undefined
        utm_content: string | null | undefined
        utm_term: string | null | undefined
        gclid: string | null | undefined
        fbclid: string | null | undefined
        ttclid: string | null | undefined
        raw_parameters: Json | null | undefined
        created_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        visitor_id: string | undefined
        external_session_id: string | undefined
        started_at: string | undefined
        ended_at: string | undefined
        landing_url: string | undefined
        referrer: string | undefined
        utm_source: string | undefined
        utm_medium: string | undefined
        utm_campaign: string | undefined
        utm_content: string | undefined
        utm_term: string | undefined
        gclid: string | undefined
        fbclid: string | undefined
        ttclid: string | undefined
        raw_parameters: Json | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    AnalyticsTouchpoints: {
      Row: {
        id: string | null
        visitor_id: string | null
        session_id: string | null
        contact_id: string | null
        occurred_at: string | null
        channel: string | null
        source: string | null
        medium: string | null
        campaign: string | null
        ad_set: string | null
        ad: string | null
        creative: string | null
        landing_url: string | null
        referrer: string | null
        click_id_type: string | null
        click_id: string | null
        capture_method: string | null
        observation_type: string | null
        consent_snapshot: Json | null
        raw_payload: Json | null
        created_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        visitor_id: string | null | undefined
        session_id: string | null | undefined
        contact_id: string | null | undefined
        occurred_at: string | null | undefined
        channel: string | null | undefined
        source: string | null | undefined
        medium: string | null | undefined
        campaign: string | null | undefined
        ad_set: string | null | undefined
        ad: string | null | undefined
        creative: string | null | undefined
        landing_url: string | null | undefined
        referrer: string | null | undefined
        click_id_type: string | null | undefined
        click_id: string | null | undefined
        capture_method: string | null | undefined
        observation_type: string | null | undefined
        consent_snapshot: Json | null | undefined
        raw_payload: Json | null | undefined
        created_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        visitor_id: string | undefined
        session_id: string | undefined
        contact_id: string | undefined
        occurred_at: string | undefined
        channel: string | undefined
        source: string | undefined
        medium: string | undefined
        campaign: string | undefined
        ad_set: string | undefined
        ad: string | undefined
        creative: string | undefined
        landing_url: string | undefined
        referrer: string | undefined
        click_id_type: string | undefined
        click_id: string | undefined
        capture_method: string | undefined
        observation_type: string | undefined
        consent_snapshot: Json | undefined
        raw_payload: Json | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    AnalyticsVisitors: {
      Row: {
        id: string | null
        anonymous_id: string | null
        contact_id: string | null
        first_seen_at: string | null
        last_seen_at: string | null
        created_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        anonymous_id: string | null | undefined
        contact_id: string | null | undefined
        first_seen_at: string | null | undefined
        last_seen_at: string | null | undefined
        created_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        anonymous_id: string | undefined
        contact_id: string | undefined
        first_seen_at: string | undefined
        last_seen_at: string | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    AppSettings: {
      Row: {
        key: string | null
        value: Json | null
        updated_at: string | null
        tenant_id: string | null
      }
      Insert: {
        key: string | null | undefined
        value: Json | null | undefined
        updated_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        key: string | undefined
        value: Json | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    Appointments: {
      Row: {
        id: string | null
        external_source: string | null
        external_id: string | null
        contact_id: string | null
        appointment_datetime: string | null
        status: string | null
        setter_id: string | null
        closer_id: string | null
        source: string | null
        pipeline_name: string | null
        pipeline_stage: string | null
        calendar_name: string | null
        utm_source: string | null
        utm_medium: string | null
        utm_campaign: string | null
        utm_content: string | null
        utm_term: string | null
        raw_payload: Json | null
        notes: string | null
        created_at: string | null
        updated_at: string | null
        recording_url: string | null
        result: string | null
        appointment_type: string | null
        origin_appointment_id: string | null
        event_type: string | null
        grade: number | null
        triager_id: string | null
        cold_caller_id: string | null
        affiliate_id: string | null
        pipe_value: number | string | null
        offered: boolean | null
        payment_deal: string | null
        qualification: Json | null
        transcript: string | null
        transcript_drive_url: string | null
        transcript_status: string | null
        ai_call_score: number | null
        ai_lead_score: number | null
        ai_suggested_stage: string | null
        ai_summary: string | null
        ai_analysis: Json | null
        ai_analyzed_at: string | null
        duration_minutes: number | null
        meeting_url: string | null
        reschedule_url: string | null
        calendly_event_uuid: string | null
        needs_followup: boolean | null
        calendly_cleanup_pending: boolean | null
        calendly_cleanup_event_uuid: string | null
        followup_stage: string | null
        last_contacted_at: string | null
        rescheduled_from_status: string | null
        library_shared: boolean | null
        tenant_id: string | null
        fathom_meeting_id: string | null
        offered_by: string | null
        offered_at: string | null
      }
      Insert: {
        id: string | null | undefined
        external_source: string | null | undefined
        external_id: string | null | undefined
        contact_id: string | null | undefined
        appointment_datetime: string | null | undefined
        status: string | null | undefined
        setter_id: string | null | undefined
        closer_id: string | null | undefined
        source: string | null | undefined
        pipeline_name: string | null | undefined
        pipeline_stage: string | null | undefined
        calendar_name: string | null | undefined
        utm_source: string | null | undefined
        utm_medium: string | null | undefined
        utm_campaign: string | null | undefined
        utm_content: string | null | undefined
        utm_term: string | null | undefined
        raw_payload: Json | null | undefined
        notes: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        recording_url: string | null | undefined
        result: string | null | undefined
        appointment_type: string | null | undefined
        origin_appointment_id: string | null | undefined
        event_type: string | null | undefined
        grade: number | null | undefined
        triager_id: string | null | undefined
        cold_caller_id: string | null | undefined
        affiliate_id: string | null | undefined
        pipe_value: number | string | null | undefined
        offered: boolean | null | undefined
        payment_deal: string | null | undefined
        qualification: Json | null | undefined
        transcript: string | null | undefined
        transcript_drive_url: string | null | undefined
        transcript_status: string | null | undefined
        ai_call_score: number | null | undefined
        ai_lead_score: number | null | undefined
        ai_suggested_stage: string | null | undefined
        ai_summary: string | null | undefined
        ai_analysis: Json | null | undefined
        ai_analyzed_at: string | null | undefined
        duration_minutes: number | null | undefined
        meeting_url: string | null | undefined
        reschedule_url: string | null | undefined
        calendly_event_uuid: string | null | undefined
        needs_followup: boolean | null | undefined
        calendly_cleanup_pending: boolean | null | undefined
        calendly_cleanup_event_uuid: string | null | undefined
        followup_stage: string | null | undefined
        last_contacted_at: string | null | undefined
        rescheduled_from_status: string | null | undefined
        library_shared: boolean | null | undefined
        tenant_id: string | null | undefined
        fathom_meeting_id: string | null | undefined
        offered_by: string | null | undefined
        offered_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        external_source: string | undefined
        external_id: string | undefined
        contact_id: string | undefined
        appointment_datetime: string | undefined
        status: string | undefined
        setter_id: string | undefined
        closer_id: string | undefined
        source: string | undefined
        pipeline_name: string | undefined
        pipeline_stage: string | undefined
        calendar_name: string | undefined
        utm_source: string | undefined
        utm_medium: string | undefined
        utm_campaign: string | undefined
        utm_content: string | undefined
        utm_term: string | undefined
        raw_payload: Json | undefined
        notes: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        recording_url: string | undefined
        result: string | undefined
        appointment_type: string | undefined
        origin_appointment_id: string | undefined
        event_type: string | undefined
        grade: number | undefined
        triager_id: string | undefined
        cold_caller_id: string | undefined
        affiliate_id: string | undefined
        pipe_value: number | string | undefined
        offered: boolean | undefined
        payment_deal: string | undefined
        qualification: Json | undefined
        transcript: string | undefined
        transcript_drive_url: string | undefined
        transcript_status: string | undefined
        ai_call_score: number | undefined
        ai_lead_score: number | undefined
        ai_suggested_stage: string | undefined
        ai_summary: string | undefined
        ai_analysis: Json | undefined
        ai_analyzed_at: string | undefined
        duration_minutes: number | undefined
        meeting_url: string | undefined
        reschedule_url: string | undefined
        calendly_event_uuid: string | undefined
        needs_followup: boolean | undefined
        calendly_cleanup_pending: boolean | undefined
        calendly_cleanup_event_uuid: string | undefined
        followup_stage: string | undefined
        last_contacted_at: string | undefined
        rescheduled_from_status: string | undefined
        library_shared: boolean | undefined
        tenant_id: string | undefined
        fathom_meeting_id: string | undefined
        offered_by: string | undefined
        offered_at: string | undefined
      }
    }
    AuditLogs: {
      Row: {
        id: string | null
        actor_user_id: string | null
        entity_type: string | null
        entity_id: string | null
        action: string | null
        old_values: Json | null
        new_values: Json | null
        created_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        actor_user_id: string | null | undefined
        entity_type: string | null | undefined
        entity_id: string | null | undefined
        action: string | null | undefined
        old_values: Json | null | undefined
        new_values: Json | null | undefined
        created_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        actor_user_id: string | undefined
        entity_type: string | undefined
        entity_id: string | undefined
        action: string | undefined
        old_values: Json | undefined
        new_values: Json | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    CallRecordings: {
      Row: {
        id: string | null
        tenant_id: string | null
        storage_path: string | null
        file_name: string | null
        mime_type: string | null
        size_bytes: number | string | null
        sha256: string | null
        category: string | null
        status: string | null
        appointment_id: string | null
        notes: string | null
        uploaded_by: string | null
        reviewed_by: string | null
        reviewed_at: string | null
        created_at: string | null
        updated_at: string | null
      }
      Insert: {
        id: string | null | undefined
        tenant_id: string | null | undefined
        storage_path: string | null | undefined
        file_name: string | null | undefined
        mime_type: string | null | undefined
        size_bytes: number | string | null | undefined
        sha256: string | null | undefined
        category: string | null | undefined
        status: string | null | undefined
        appointment_id: string | null | undefined
        notes: string | null | undefined
        uploaded_by: string | null | undefined
        reviewed_by: string | null | undefined
        reviewed_at: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        storage_path: string | undefined
        file_name: string | undefined
        mime_type: string | undefined
        size_bytes: number | string | undefined
        sha256: string | undefined
        category: string | undefined
        status: string | undefined
        appointment_id: string | undefined
        notes: string | undefined
        uploaded_by: string | undefined
        reviewed_by: string | undefined
        reviewed_at: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    CampaignAds: {
      Row: {
        id: string | null
        external_id: string | null
        campaign_external_id: string | null
        campaign_id: string | null
        account_id: string | null
        account_name: string | null
        name: string | null
        adset_name: string | null
        status: string | null
        spend: number | string | null
        impressions: number | string | null
        clicks: number | string | null
        reach: number | string | null
        link_clicks: number | string | null
        landing_views: number | string | null
        leads: number | null
        followers: number | null
        synced_at: string | null
        created_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        external_id: string | null | undefined
        campaign_external_id: string | null | undefined
        campaign_id: string | null | undefined
        account_id: string | null | undefined
        account_name: string | null | undefined
        name: string | null | undefined
        adset_name: string | null | undefined
        status: string | null | undefined
        spend: number | string | null | undefined
        impressions: number | string | null | undefined
        clicks: number | string | null | undefined
        reach: number | string | null | undefined
        link_clicks: number | string | null | undefined
        landing_views: number | string | null | undefined
        leads: number | null | undefined
        followers: number | null | undefined
        synced_at: string | null | undefined
        created_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        external_id: string | undefined
        campaign_external_id: string | undefined
        campaign_id: string | undefined
        account_id: string | undefined
        account_name: string | undefined
        name: string | undefined
        adset_name: string | undefined
        status: string | undefined
        spend: number | string | undefined
        impressions: number | string | undefined
        clicks: number | string | undefined
        reach: number | string | undefined
        link_clicks: number | string | undefined
        landing_views: number | string | undefined
        leads: number | undefined
        followers: number | undefined
        synced_at: string | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    CampaignDaily: {
      Row: {
        id: string | null
        campaign_id: string | null
        external_id: string | null
        account_id: string | null
        date: string | null
        spend: number | string | null
        impressions: number | string | null
        clicks: number | string | null
        leads: number | null
        reach: number | string | null
        updated_at: string | null
        link_clicks: number | string | null
        landing_views: number | string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        campaign_id: string | null | undefined
        external_id: string | null | undefined
        account_id: string | null | undefined
        date: string | null | undefined
        spend: number | string | null | undefined
        impressions: number | string | null | undefined
        clicks: number | string | null | undefined
        leads: number | null | undefined
        reach: number | string | null | undefined
        updated_at: string | null | undefined
        link_clicks: number | string | null | undefined
        landing_views: number | string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        campaign_id: string | undefined
        external_id: string | undefined
        account_id: string | undefined
        date: string | undefined
        spend: number | string | undefined
        impressions: number | string | undefined
        clicks: number | string | undefined
        leads: number | undefined
        reach: number | string | undefined
        updated_at: string | undefined
        link_clicks: number | string | undefined
        landing_views: number | string | undefined
        tenant_id: string | undefined
      }
    }
    CampaignTargets: {
      Row: {
        id: string | null
        tenant_id: string | null
        target_roas: number | string | null
        target_cac: number | string | null
        target_cpl: number | string | null
        updated_by: string | null
        created_at: string | null
        updated_at: string | null
      }
      Insert: {
        id: string | null | undefined
        tenant_id: string | null | undefined
        target_roas: number | string | null | undefined
        target_cac: number | string | null | undefined
        target_cpl: number | string | null | undefined
        updated_by: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        target_roas: number | string | undefined
        target_cac: number | string | undefined
        target_cpl: number | string | undefined
        updated_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    Campaigns: {
      Row: {
        id: string | null
        name: string | null
        channel: string | null
        type: string | null
        start_date: string | null
        end_date: string | null
        budget: number | string | null
        adspend: number | string | null
        impressions: number | string | null
        clicks: number | string | null
        leads_generated: number | null
        status: string | null
        ad_source: string | null
        notes: string | null
        created_by: string | null
        created_at: string | null
        updated_at: string | null
        provider: string | null
        external_id: string | null
        reach: number | null
        meta_leads: number | null
        funnel_leads: number | null
        synced_at: string | null
        account_id: string | null
        link_clicks: number | string | null
        landing_views: number | string | null
        appointments_count: number | null
        shows_count: number | null
        sales_count: number | null
        sales_revenue: number | string | null
        account_name: string | null
        followers: number | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        name: string | null | undefined
        channel: string | null | undefined
        type: string | null | undefined
        start_date: string | null | undefined
        end_date: string | null | undefined
        budget: number | string | null | undefined
        adspend: number | string | null | undefined
        impressions: number | string | null | undefined
        clicks: number | string | null | undefined
        leads_generated: number | null | undefined
        status: string | null | undefined
        ad_source: string | null | undefined
        notes: string | null | undefined
        created_by: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        provider: string | null | undefined
        external_id: string | null | undefined
        reach: number | null | undefined
        meta_leads: number | null | undefined
        funnel_leads: number | null | undefined
        synced_at: string | null | undefined
        account_id: string | null | undefined
        link_clicks: number | string | null | undefined
        landing_views: number | string | null | undefined
        appointments_count: number | null | undefined
        shows_count: number | null | undefined
        sales_count: number | null | undefined
        sales_revenue: number | string | null | undefined
        account_name: string | null | undefined
        followers: number | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        name: string | undefined
        channel: string | undefined
        type: string | undefined
        start_date: string | undefined
        end_date: string | undefined
        budget: number | string | undefined
        adspend: number | string | undefined
        impressions: number | string | undefined
        clicks: number | string | undefined
        leads_generated: number | undefined
        status: string | undefined
        ad_source: string | undefined
        notes: string | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        provider: string | undefined
        external_id: string | undefined
        reach: number | undefined
        meta_leads: number | undefined
        funnel_leads: number | undefined
        synced_at: string | undefined
        account_id: string | undefined
        link_clicks: number | string | undefined
        landing_views: number | string | undefined
        appointments_count: number | undefined
        shows_count: number | undefined
        sales_count: number | undefined
        sales_revenue: number | string | undefined
        account_name: string | undefined
        followers: number | undefined
        tenant_id: string | undefined
      }
    }
    CanonicalEvents: {
      Row: {
        id: string | null
        event_id: string | null
        event_name: string | null
        occurred_at: string | null
        received_at: string | null
        source: string | null
        schema_version: string | null
        idempotency_key: string | null
        visitor_id: string | null
        session_id: string | null
        touchpoint_id: string | null
        contact_id: string | null
        appointment_id: string | null
        sale_id: string | null
        revenue: number | string | null
        currency: string | null
        consent_snapshot: Json | null
        properties: Json | null
        processing_status: string | null
        rejection_reason: string | null
        created_at: string | null
        tenant_id: string | null
        site_id: string | null
        raw_event_id: string | null
        source_event_id: string | null
        processed_at: string | null
      }
      Insert: {
        id: string | null | undefined
        event_id: string | null | undefined
        event_name: string | null | undefined
        occurred_at: string | null | undefined
        received_at: string | null | undefined
        source: string | null | undefined
        schema_version: string | null | undefined
        idempotency_key: string | null | undefined
        visitor_id: string | null | undefined
        session_id: string | null | undefined
        touchpoint_id: string | null | undefined
        contact_id: string | null | undefined
        appointment_id: string | null | undefined
        sale_id: string | null | undefined
        revenue: number | string | null | undefined
        currency: string | null | undefined
        consent_snapshot: Json | null | undefined
        properties: Json | null | undefined
        processing_status: string | null | undefined
        rejection_reason: string | null | undefined
        created_at: string | null | undefined
        tenant_id: string | null | undefined
        site_id: string | null | undefined
        raw_event_id: string | null | undefined
        source_event_id: string | null | undefined
        processed_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        event_id: string | undefined
        event_name: string | undefined
        occurred_at: string | undefined
        received_at: string | undefined
        source: string | undefined
        schema_version: string | undefined
        idempotency_key: string | undefined
        visitor_id: string | undefined
        session_id: string | undefined
        touchpoint_id: string | undefined
        contact_id: string | undefined
        appointment_id: string | undefined
        sale_id: string | undefined
        revenue: number | string | undefined
        currency: string | undefined
        consent_snapshot: Json | undefined
        properties: Json | undefined
        processing_status: string | undefined
        rejection_reason: string | undefined
        created_at: string | undefined
        tenant_id: string | undefined
        site_id: string | undefined
        raw_event_id: string | undefined
        source_event_id: string | undefined
        processed_at: string | undefined
      }
    }
    CarruselBrand: {
      Row: {
        id: string | null
        tenant_id: string | null
        name: string | null
        colors: Json | null
        fonts: Json | null
        logo_url: string | null
        style_keywords: Json | null
        updated_at: string | null
      }
      Insert: {
        id: string | null | undefined
        tenant_id: string | null | undefined
        name: string | null | undefined
        colors: Json | null | undefined
        fonts: Json | null | undefined
        logo_url: string | null | undefined
        style_keywords: Json | null | undefined
        updated_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        name: string | undefined
        colors: Json | undefined
        fonts: Json | undefined
        logo_url: string | undefined
        style_keywords: Json | undefined
        updated_at: string | undefined
      }
    }
    CarruselProjects: {
      Row: {
        id: string | null
        tenant_id: string | null
        title: string | null
        kind: string | null
        aspect_ratio: string | null
        slides: Json | null
        reference_images: Json | null
        caption: string | null
        hashtags: Json | null
        is_template: boolean | null
        created_by: string | null
        created_at: string | null
        updated_at: string | null
      }
      Insert: {
        id: string | null | undefined
        tenant_id: string | null | undefined
        title: string | null | undefined
        kind: string | null | undefined
        aspect_ratio: string | null | undefined
        slides: Json | null | undefined
        reference_images: Json | null | undefined
        caption: string | null | undefined
        hashtags: Json | null | undefined
        is_template: boolean | null | undefined
        created_by: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        title: string | undefined
        kind: string | undefined
        aspect_ratio: string | undefined
        slides: Json | undefined
        reference_images: Json | undefined
        caption: string | undefined
        hashtags: Json | undefined
        is_template: boolean | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    CarruselTemplates: {
      Row: {
        id: string | null
        tenant_id: string | null
        title: string | null
        kind: string | null
        aspect_ratio: string | null
        slides: Json | null
        created_at: string | null
      }
      Insert: {
        id: string | null | undefined
        tenant_id: string | null | undefined
        title: string | null | undefined
        kind: string | null | undefined
        aspect_ratio: string | null | undefined
        slides: Json | null | undefined
        created_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        title: string | undefined
        kind: string | undefined
        aspect_ratio: string | undefined
        slides: Json | undefined
        created_at: string | undefined
      }
    }
    CollaboratorProfiles: {
      Row: {
        id: string | null
        tenant_id: string | null
        user_id: string | null
        code: string | null
        name: string | null
        status: string | null
        contract_id: string | null
        contract_version: string | null
        contract_signed_at: string | null
        default_commission_percent: number | string | null
        notes: string | null
        created_at: string | null
        updated_at: string | null
      }
      Insert: {
        id: string | null | undefined
        tenant_id: string | null | undefined
        user_id: string | null | undefined
        code: string | null | undefined
        name: string | null | undefined
        status: string | null | undefined
        contract_id: string | null | undefined
        contract_version: string | null | undefined
        contract_signed_at: string | null | undefined
        default_commission_percent: number | string | null | undefined
        notes: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        user_id: string | undefined
        code: string | undefined
        name: string | undefined
        status: string | undefined
        contract_id: string | undefined
        contract_version: string | undefined
        contract_signed_at: string | undefined
        default_commission_percent: number | string | undefined
        notes: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    Collections: {
      Row: {
        id: string | null
        sale_id: string | null
        expected_installment_id: string | null
        collected_at: string | null
        gross_amount: number | string | null
        commissionable_amount: number | string | null
        payment_method: string | null
        payment_provider: string | null
        payment_reference: string | null
        is_confirmed: boolean | null
        is_eligible_for_commission: boolean | null
        eligible_at: string | null
        status: string | null
        notes: string | null
        created_at: string | null
        updated_at: string | null
        recovered: boolean | null
        recovered_at: string | null
        processing_fee: number | string | null
        extra_fee: number | string | null
        payment_channel: string | null
        from_follow_up: boolean | null
        vat: number | string | null
        invoice_link: string | null
        billing_info: string | null
        needs_commission_review: boolean | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        sale_id: string | null | undefined
        expected_installment_id: string | null | undefined
        collected_at: string | null | undefined
        gross_amount: number | string | null | undefined
        commissionable_amount: number | string | null | undefined
        payment_method: string | null | undefined
        payment_provider: string | null | undefined
        payment_reference: string | null | undefined
        is_confirmed: boolean | null | undefined
        is_eligible_for_commission: boolean | null | undefined
        eligible_at: string | null | undefined
        status: string | null | undefined
        notes: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        recovered: boolean | null | undefined
        recovered_at: string | null | undefined
        processing_fee: number | string | null | undefined
        extra_fee: number | string | null | undefined
        payment_channel: string | null | undefined
        from_follow_up: boolean | null | undefined
        vat: number | string | null | undefined
        invoice_link: string | null | undefined
        billing_info: string | null | undefined
        needs_commission_review: boolean | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        sale_id: string | undefined
        expected_installment_id: string | undefined
        collected_at: string | undefined
        gross_amount: number | string | undefined
        commissionable_amount: number | string | undefined
        payment_method: string | undefined
        payment_provider: string | undefined
        payment_reference: string | undefined
        is_confirmed: boolean | undefined
        is_eligible_for_commission: boolean | undefined
        eligible_at: string | undefined
        status: string | undefined
        notes: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        recovered: boolean | undefined
        recovered_at: string | undefined
        processing_fee: number | string | undefined
        extra_fee: number | string | undefined
        payment_channel: string | undefined
        from_follow_up: boolean | undefined
        vat: number | string | undefined
        invoice_link: string | undefined
        billing_info: string | undefined
        needs_commission_review: boolean | undefined
        tenant_id: string | undefined
      }
    }
    CommissionInvoices: {
      Row: {
        id: string | null
        user_id: string | null
        period_month: string | null
        invoice_url: string | null
        amount: number | string | null
        status: string | null
        notes: string | null
        created_at: string | null
        updated_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        user_id: string | null | undefined
        period_month: string | null | undefined
        invoice_url: string | null | undefined
        amount: number | string | null | undefined
        status: string | null | undefined
        notes: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        user_id: string | undefined
        period_month: string | undefined
        invoice_url: string | undefined
        amount: number | string | undefined
        status: string | undefined
        notes: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    CommissionRules: {
      Row: {
        id: string | null
        participant_type: string | null
        percent: number | string | null
        active_from: string | null
        active_to: string | null
        is_active: boolean | null
        created_at: string | null
        updated_at: string | null
        user_id: string | null
        min_cash: number | string | null
        max_cash: number | string | null
        label: string | null
        tramo_id: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        participant_type: string | null | undefined
        percent: number | string | null | undefined
        active_from: string | null | undefined
        active_to: string | null | undefined
        is_active: boolean | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        user_id: string | null | undefined
        min_cash: number | string | null | undefined
        max_cash: number | string | null | undefined
        label: string | null | undefined
        tramo_id: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        participant_type: string | undefined
        percent: number | string | undefined
        active_from: string | undefined
        active_to: string | undefined
        is_active: boolean | undefined
        created_at: string | undefined
        updated_at: string | undefined
        user_id: string | undefined
        min_cash: number | string | undefined
        max_cash: number | string | undefined
        label: string | undefined
        tramo_id: string | undefined
        tenant_id: string | undefined
      }
    }
    Commissions: {
      Row: {
        id: string | null
        sale_id: string | null
        collection_id: string | null
        refund_id: string | null
        user_id: string | null
        participant_type: string | null
        percent: number | string | null
        base_amount: number | string | null
        commission_amount: number | string | null
        direction: string | null
        status: string | null
        liquidation_month: string | null
        approved_by: string | null
        notes: string | null
        created_at: string | null
        updated_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        sale_id: string | null | undefined
        collection_id: string | null | undefined
        refund_id: string | null | undefined
        user_id: string | null | undefined
        participant_type: string | null | undefined
        percent: number | string | null | undefined
        base_amount: number | string | null | undefined
        commission_amount: number | string | null | undefined
        direction: string | null | undefined
        status: string | null | undefined
        liquidation_month: string | null | undefined
        approved_by: string | null | undefined
        notes: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        sale_id: string | undefined
        collection_id: string | undefined
        refund_id: string | undefined
        user_id: string | undefined
        participant_type: string | undefined
        percent: number | string | undefined
        base_amount: number | string | undefined
        commission_amount: number | string | undefined
        direction: string | undefined
        status: string | undefined
        liquidation_month: string | undefined
        approved_by: string | undefined
        notes: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    CompanyProfile: {
      Row: {
        id: number | null
        name: string | null
        legal_name: string | null
        cif: string | null
        address: string | null
        postal_code: string | null
        city: string | null
        country: string | null
        representative: string | null
        email: string | null
        phone: string | null
        logo_url: string | null
        email_signature: string | null
        updated_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: number | null | undefined
        name: string | null | undefined
        legal_name: string | null | undefined
        cif: string | null | undefined
        address: string | null | undefined
        postal_code: string | null | undefined
        city: string | null | undefined
        country: string | null | undefined
        representative: string | null | undefined
        email: string | null | undefined
        phone: string | null | undefined
        logo_url: string | null | undefined
        email_signature: string | null | undefined
        updated_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: number | undefined
        name: string | undefined
        legal_name: string | undefined
        cif: string | undefined
        address: string | undefined
        postal_code: string | undefined
        city: string | undefined
        country: string | undefined
        representative: string | undefined
        email: string | undefined
        phone: string | undefined
        logo_url: string | undefined
        email_signature: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    ContactAttributions: {
      Row: {
        id: string | null
        contact_id: string | null
        source: string | null
        funnel: string | null
        landing_url: string | null
        utm_source: string | null
        utm_medium: string | null
        utm_campaign: string | null
        utm_content: string | null
        utm_term: string | null
        first_touch_at: string | null
        last_touch_at: string | null
        is_primary: boolean | null
        created_at: string | null
        updated_at: string | null
        first_utm_source: string | null
        first_utm_medium: string | null
        first_utm_campaign: string | null
        first_utm_content: string | null
        first_utm_term: string | null
        last_utm_source: string | null
        last_utm_medium: string | null
        last_utm_campaign: string | null
        last_utm_content: string | null
        last_utm_term: string | null
        tenant_id: string | null
        collaborator_id: string | null
      }
      Insert: {
        id: string | null | undefined
        contact_id: string | null | undefined
        source: string | null | undefined
        funnel: string | null | undefined
        landing_url: string | null | undefined
        utm_source: string | null | undefined
        utm_medium: string | null | undefined
        utm_campaign: string | null | undefined
        utm_content: string | null | undefined
        utm_term: string | null | undefined
        first_touch_at: string | null | undefined
        last_touch_at: string | null | undefined
        is_primary: boolean | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        first_utm_source: string | null | undefined
        first_utm_medium: string | null | undefined
        first_utm_campaign: string | null | undefined
        first_utm_content: string | null | undefined
        first_utm_term: string | null | undefined
        last_utm_source: string | null | undefined
        last_utm_medium: string | null | undefined
        last_utm_campaign: string | null | undefined
        last_utm_content: string | null | undefined
        last_utm_term: string | null | undefined
        tenant_id: string | null | undefined
        collaborator_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        contact_id: string | undefined
        source: string | undefined
        funnel: string | undefined
        landing_url: string | undefined
        utm_source: string | undefined
        utm_medium: string | undefined
        utm_campaign: string | undefined
        utm_content: string | undefined
        utm_term: string | undefined
        first_touch_at: string | undefined
        last_touch_at: string | undefined
        is_primary: boolean | undefined
        created_at: string | undefined
        updated_at: string | undefined
        first_utm_source: string | undefined
        first_utm_medium: string | undefined
        first_utm_campaign: string | undefined
        first_utm_content: string | undefined
        first_utm_term: string | undefined
        last_utm_source: string | undefined
        last_utm_medium: string | undefined
        last_utm_campaign: string | undefined
        last_utm_content: string | undefined
        last_utm_term: string | undefined
        tenant_id: string | undefined
        collaborator_id: string | undefined
      }
    }
    ContactNotes: {
      Row: {
        id: string | null
        contact_id: string | null
        author_id: string | null
        note: string | null
        pinned: boolean | null
        created_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        contact_id: string | null | undefined
        author_id: string | null | undefined
        note: string | null | undefined
        pinned: boolean | null | undefined
        created_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        contact_id: string | undefined
        author_id: string | undefined
        note: string | undefined
        pinned: boolean | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    Contacts: {
      Row: {
        id: string | null
        first_name: string | null
        last_name: string | null
        full_name: string | null
        email: string | null
        phone: string | null
        country: string | null
        company_name: string | null
        notes: string | null
        first_seen_at: string | null
        last_seen_at: string | null
        created_at: string | null
        updated_at: string | null
        instagram: string | null
        lead_channel: string | null
        lead_status: string | null
        vsl_watch_pct: number | string | null
        vsl_watched_at: string | null
        lead_score: number | null
        first_contact_at: string | null
        contact_attempts: number | null
        discard_reason: string | null
        referred_by: string | null
        campaign_id: string | null
        set_source: string | null
        optin_date: string | null
        gender: string | null
        age: number | null
        engagement_score: string | null
        ttfv_date: string | null
        nps: number | null
        nps_date: string | null
        promise_fulfilled: string | null
        ghl_contact_id: string | null
        qualification: Json | null
        qualification_updated_at: string | null
        tenant_id: string | null
        merged_into: string | null
        email_normalized: string | null
        phone_normalized: string | null
      }
      Insert: {
        id: string | null | undefined
        first_name: string | null | undefined
        last_name: string | null | undefined
        full_name: string | null | undefined
        email: string | null | undefined
        phone: string | null | undefined
        country: string | null | undefined
        company_name: string | null | undefined
        notes: string | null | undefined
        first_seen_at: string | null | undefined
        last_seen_at: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        instagram: string | null | undefined
        lead_channel: string | null | undefined
        lead_status: string | null | undefined
        vsl_watch_pct: number | string | null | undefined
        vsl_watched_at: string | null | undefined
        lead_score: number | null | undefined
        first_contact_at: string | null | undefined
        contact_attempts: number | null | undefined
        discard_reason: string | null | undefined
        referred_by: string | null | undefined
        campaign_id: string | null | undefined
        set_source: string | null | undefined
        optin_date: string | null | undefined
        gender: string | null | undefined
        age: number | null | undefined
        engagement_score: string | null | undefined
        ttfv_date: string | null | undefined
        nps: number | null | undefined
        nps_date: string | null | undefined
        promise_fulfilled: string | null | undefined
        ghl_contact_id: string | null | undefined
        qualification: Json | null | undefined
        qualification_updated_at: string | null | undefined
        tenant_id: string | null | undefined
        merged_into: string | null | undefined
        email_normalized: string | null | undefined
        phone_normalized: string | null | undefined
      }
      Update: {
        id: string | undefined
        first_name: string | undefined
        last_name: string | undefined
        full_name: string | undefined
        email: string | undefined
        phone: string | undefined
        country: string | undefined
        company_name: string | undefined
        notes: string | undefined
        first_seen_at: string | undefined
        last_seen_at: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        instagram: string | undefined
        lead_channel: string | undefined
        lead_status: string | undefined
        vsl_watch_pct: number | string | undefined
        vsl_watched_at: string | undefined
        lead_score: number | undefined
        first_contact_at: string | undefined
        contact_attempts: number | undefined
        discard_reason: string | undefined
        referred_by: string | undefined
        campaign_id: string | undefined
        set_source: string | undefined
        optin_date: string | undefined
        gender: string | undefined
        age: number | undefined
        engagement_score: string | undefined
        ttfv_date: string | undefined
        nps: number | undefined
        nps_date: string | undefined
        promise_fulfilled: string | undefined
        ghl_contact_id: string | undefined
        qualification: Json | undefined
        qualification_updated_at: string | undefined
        tenant_id: string | undefined
        merged_into: string | undefined
        email_normalized: string | undefined
        phone_normalized: string | undefined
      }
    }
    ContentItems: {
      Row: {
        id: string | null
        title: string | null
        content_type: string | null
        status: string | null
        link_url: string | null
        publish_date: string | null
        assigned_to: string | null
        notes: string | null
        created_by: string | null
        created_at: string | null
        updated_at: string | null
        solution_explanation: string | null
        solution_link: string | null
        reference_reel_url: string | null
        reference_transcript: string | null
        our_reel_url: string | null
        script: string | null
        testimonio_id: string | null
        sort_order: number | null
        price: number | string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        title: string | null | undefined
        content_type: string | null | undefined
        status: string | null | undefined
        link_url: string | null | undefined
        publish_date: string | null | undefined
        assigned_to: string | null | undefined
        notes: string | null | undefined
        created_by: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        solution_explanation: string | null | undefined
        solution_link: string | null | undefined
        reference_reel_url: string | null | undefined
        reference_transcript: string | null | undefined
        our_reel_url: string | null | undefined
        script: string | null | undefined
        testimonio_id: string | null | undefined
        sort_order: number | null | undefined
        price: number | string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        title: string | undefined
        content_type: string | undefined
        status: string | undefined
        link_url: string | undefined
        publish_date: string | undefined
        assigned_to: string | undefined
        notes: string | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        solution_explanation: string | undefined
        solution_link: string | undefined
        reference_reel_url: string | undefined
        reference_transcript: string | undefined
        our_reel_url: string | undefined
        script: string | undefined
        testimonio_id: string | undefined
        sort_order: number | undefined
        price: number | string | undefined
        tenant_id: string | undefined
      }
    }
    ContractTemplates: {
      Row: {
        id: string | null
        name: string | null
        role_key: string | null
        body: string | null
        is_active: boolean | null
        created_by: string | null
        created_at: string | null
        updated_at: string | null
        kind: string | null
        welcome_message: string | null
        payment_method: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        name: string | null | undefined
        role_key: string | null | undefined
        body: string | null | undefined
        is_active: boolean | null | undefined
        created_by: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        kind: string | null | undefined
        welcome_message: string | null | undefined
        payment_method: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        name: string | undefined
        role_key: string | undefined
        body: string | undefined
        is_active: boolean | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        kind: string | undefined
        welcome_message: string | undefined
        payment_method: string | undefined
        tenant_id: string | undefined
      }
    }
    Contracts: {
      Row: {
        id: string | null
        sale_id: string | null
        contact_id: string | null
        title: string | null
        url: string | null
        status: string | null
        signed_at: string | null
        notes: string | null
        created_by: string | null
        created_at: string | null
        updated_at: string | null
        user_id: string | null
        template_id: string | null
        kind: string | null
        signing_token: string | null
        terms: Json | null
        body_snapshot: string | null
        sent_at: string | null
        signer_name: string | null
        signer_ip: string | null
        signer_user_agent: string | null
        signed_hash: string | null
        signed_pdf_url: string | null
        signer_data: Json | null
        contract_role: string | null
        email_sent_at: string | null
        read_at: string | null
        accesos_enviados_at: string | null
        accesos_abiertos_at: string | null
        onboarding_webhook_ok: boolean | null
        is_reservation: boolean | null
        contract_party: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        sale_id: string | null | undefined
        contact_id: string | null | undefined
        title: string | null | undefined
        url: string | null | undefined
        status: string | null | undefined
        signed_at: string | null | undefined
        notes: string | null | undefined
        created_by: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        user_id: string | null | undefined
        template_id: string | null | undefined
        kind: string | null | undefined
        signing_token: string | null | undefined
        terms: Json | null | undefined
        body_snapshot: string | null | undefined
        sent_at: string | null | undefined
        signer_name: string | null | undefined
        signer_ip: string | null | undefined
        signer_user_agent: string | null | undefined
        signed_hash: string | null | undefined
        signed_pdf_url: string | null | undefined
        signer_data: Json | null | undefined
        contract_role: string | null | undefined
        email_sent_at: string | null | undefined
        read_at: string | null | undefined
        accesos_enviados_at: string | null | undefined
        accesos_abiertos_at: string | null | undefined
        onboarding_webhook_ok: boolean | null | undefined
        is_reservation: boolean | null | undefined
        contract_party: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        sale_id: string | undefined
        contact_id: string | undefined
        title: string | undefined
        url: string | undefined
        status: string | undefined
        signed_at: string | undefined
        notes: string | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        user_id: string | undefined
        template_id: string | undefined
        kind: string | undefined
        signing_token: string | undefined
        terms: Json | undefined
        body_snapshot: string | undefined
        sent_at: string | undefined
        signer_name: string | undefined
        signer_ip: string | undefined
        signer_user_agent: string | undefined
        signed_hash: string | undefined
        signed_pdf_url: string | undefined
        signer_data: Json | undefined
        contract_role: string | undefined
        email_sent_at: string | undefined
        read_at: string | undefined
        accesos_enviados_at: string | undefined
        accesos_abiertos_at: string | undefined
        onboarding_webhook_ok: boolean | undefined
        is_reservation: boolean | undefined
        contract_party: string | undefined
        tenant_id: string | undefined
      }
    }
    CsmEvents: {
      Row: {
        id: string | null
        contact_id: string | null
        sale_id: string | null
        csm_id: string | null
        type: string | null
        event_datetime: string | null
        status: string | null
        grade: number | null
        success: string | null
        reminder: string | null
        recording_url: string | null
        notes: string | null
        created_by: string | null
        created_at: string | null
        updated_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        contact_id: string | null | undefined
        sale_id: string | null | undefined
        csm_id: string | null | undefined
        type: string | null | undefined
        event_datetime: string | null | undefined
        status: string | null | undefined
        grade: number | null | undefined
        success: string | null | undefined
        reminder: string | null | undefined
        recording_url: string | null | undefined
        notes: string | null | undefined
        created_by: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        contact_id: string | undefined
        sale_id: string | undefined
        csm_id: string | undefined
        type: string | undefined
        event_datetime: string | undefined
        status: string | undefined
        grade: number | undefined
        success: string | undefined
        reminder: string | undefined
        recording_url: string | undefined
        notes: string | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    DeletedAppointmentsLog: {
      Row: {
        id: string | null
        appointment_id: string | null
        contact_id: string | null
        snapshot: Json | null
        reason: string | null
        deleted_by: string | null
        deleted_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        appointment_id: string | null | undefined
        contact_id: string | null | undefined
        snapshot: Json | null | undefined
        reason: string | null | undefined
        deleted_by: string | null | undefined
        deleted_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        appointment_id: string | undefined
        contact_id: string | undefined
        snapshot: Json | undefined
        reason: string | undefined
        deleted_by: string | undefined
        deleted_at: string | undefined
        tenant_id: string | undefined
      }
    }
    DeliveryAttempts: {
      Row: {
        id: string | null
        event_id: string | null
        destination: string | null
        status: string | null
        http_status: number | null
        latency_ms: number | null
        attempt_number: number | null
        last_error: string | null
        next_retry_at: string | null
        response_summary: Json | null
        sent_at: string | null
        created_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        event_id: string | null | undefined
        destination: string | null | undefined
        status: string | null | undefined
        http_status: number | null | undefined
        latency_ms: number | null | undefined
        attempt_number: number | null | undefined
        last_error: string | null | undefined
        next_retry_at: string | null | undefined
        response_summary: Json | null | undefined
        sent_at: string | null | undefined
        created_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        event_id: string | undefined
        destination: string | undefined
        status: string | undefined
        http_status: number | undefined
        latency_ms: number | undefined
        attempt_number: number | undefined
        last_error: string | undefined
        next_retry_at: string | undefined
        response_summary: Json | undefined
        sent_at: string | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    DocumentVerifications: {
      Row: {
        id: string | null
        sale_id: string | null
        contact_id: string | null
        country_code: string | null
        document_type: string | null
        document_url: string | null
        verified_at: string | null
        verified_by: string | null
        status: string | null
        rejection_reason: string | null
        created_at: string | null
        updated_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        sale_id: string | null | undefined
        contact_id: string | null | undefined
        country_code: string | null | undefined
        document_type: string | null | undefined
        document_url: string | null | undefined
        verified_at: string | null | undefined
        verified_by: string | null | undefined
        status: string | null | undefined
        rejection_reason: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        sale_id: string | undefined
        contact_id: string | undefined
        country_code: string | undefined
        document_type: string | undefined
        document_url: string | undefined
        verified_at: string | undefined
        verified_by: string | undefined
        status: string | undefined
        rejection_reason: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    Drops: {
      Row: {
        id: string | null
        sale_id: string | null
        contact_id: string | null
        request_date: string | null
        effective_date: string | null
        reason: string | null
        reason_detail: string | null
        type: string | null
        handled_by: string | null
        retention_action: string | null
        result: string | null
        refund_amount: number | string | null
        notes: string | null
        created_by: string | null
        created_at: string | null
        updated_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        sale_id: string | null | undefined
        contact_id: string | null | undefined
        request_date: string | null | undefined
        effective_date: string | null | undefined
        reason: string | null | undefined
        reason_detail: string | null | undefined
        type: string | null | undefined
        handled_by: string | null | undefined
        retention_action: string | null | undefined
        result: string | null | undefined
        refund_amount: number | string | null | undefined
        notes: string | null | undefined
        created_by: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        sale_id: string | undefined
        contact_id: string | undefined
        request_date: string | undefined
        effective_date: string | undefined
        reason: string | undefined
        reason_detail: string | undefined
        type: string | undefined
        handled_by: string | undefined
        retention_action: string | undefined
        result: string | undefined
        refund_amount: number | string | undefined
        notes: string | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    EmailInvoices: {
      Row: {
        id: string | null
        tenant_id: string | null
        provider: string | null
        message_id: string | null
        attachment_id: string | null
        sha256: string | null
        from_email: string | null
        subject: string | null
        received_at: string | null
        file_name: string | null
        mime_type: string | null
        size_bytes: number | string | null
        storage_path: string | null
        status: string | null
        expense_id: string | null
        notes: string | null
        validated_by: string | null
        validated_at: string | null
        created_at: string | null
        updated_at: string | null
      }
      Insert: {
        id: string | null | undefined
        tenant_id: string | null | undefined
        provider: string | null | undefined
        message_id: string | null | undefined
        attachment_id: string | null | undefined
        sha256: string | null | undefined
        from_email: string | null | undefined
        subject: string | null | undefined
        received_at: string | null | undefined
        file_name: string | null | undefined
        mime_type: string | null | undefined
        size_bytes: number | string | null | undefined
        storage_path: string | null | undefined
        status: string | null | undefined
        expense_id: string | null | undefined
        notes: string | null | undefined
        validated_by: string | null | undefined
        validated_at: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        provider: string | undefined
        message_id: string | undefined
        attachment_id: string | undefined
        sha256: string | undefined
        from_email: string | undefined
        subject: string | undefined
        received_at: string | undefined
        file_name: string | undefined
        mime_type: string | undefined
        size_bytes: number | string | undefined
        storage_path: string | undefined
        status: string | undefined
        expense_id: string | undefined
        notes: string | undefined
        validated_by: string | undefined
        validated_at: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    Expenses: {
      Row: {
        id: string | null
        concept: string | null
        category: string | null
        subcategory: string | null
        amount: number | string | null
        expense_date: string | null
        recurring: boolean | null
        frequency: string | null
        payment_method: string | null
        status: string | null
        counterparty: string | null
        person_id: string | null
        notes: string | null
        created_by: string | null
        created_at: string | null
        updated_at: string | null
        invoice_url: string | null
        needs_review: boolean | null
        ai_extracted: Json | null
        auto_source: string | null
        period: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        concept: string | null | undefined
        category: string | null | undefined
        subcategory: string | null | undefined
        amount: number | string | null | undefined
        expense_date: string | null | undefined
        recurring: boolean | null | undefined
        frequency: string | null | undefined
        payment_method: string | null | undefined
        status: string | null | undefined
        counterparty: string | null | undefined
        person_id: string | null | undefined
        notes: string | null | undefined
        created_by: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        invoice_url: string | null | undefined
        needs_review: boolean | null | undefined
        ai_extracted: Json | null | undefined
        auto_source: string | null | undefined
        period: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        concept: string | undefined
        category: string | undefined
        subcategory: string | undefined
        amount: number | string | undefined
        expense_date: string | undefined
        recurring: boolean | undefined
        frequency: string | undefined
        payment_method: string | undefined
        status: string | undefined
        counterparty: string | undefined
        person_id: string | undefined
        notes: string | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        invoice_url: string | undefined
        needs_review: boolean | undefined
        ai_extracted: Json | undefined
        auto_source: string | undefined
        period: string | undefined
        tenant_id: string | undefined
      }
    }
    FathomMatchReview: {
      Row: {
        id: string | null
        tenant_id: string | null
        fathom_meeting_id: string | null
        meeting_started_at: string | null
        invitee_email: string | null
        recording_url: string | null
        candidate_appointment_ids: string | null
        reason_kind: string | null
        reason: string | null
        status: string | null
        resolved_appointment_id: string | null
        resolved_by: string | null
        resolved_at: string | null
        created_at: string | null
        updated_at: string | null
      }
      Insert: {
        id: string | null | undefined
        tenant_id: string | null | undefined
        fathom_meeting_id: string | null | undefined
        meeting_started_at: string | null | undefined
        invitee_email: string | null | undefined
        recording_url: string | null | undefined
        candidate_appointment_ids: string | null | undefined
        reason_kind: string | null | undefined
        reason: string | null | undefined
        status: string | null | undefined
        resolved_appointment_id: string | null | undefined
        resolved_by: string | null | undefined
        resolved_at: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        fathom_meeting_id: string | undefined
        meeting_started_at: string | undefined
        invitee_email: string | undefined
        recording_url: string | undefined
        candidate_appointment_ids: string | undefined
        reason_kind: string | undefined
        reason: string | undefined
        status: string | undefined
        resolved_appointment_id: string | undefined
        resolved_by: string | undefined
        resolved_at: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    FbMedia: {
      Row: {
        id: string | null
        external_id: string | null
        description: string | null
        permalink: string | null
        created_time: string | null
        views: number | null
        likes: number | null
        comments: number | null
        synced_at: string | null
        created_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        external_id: string | null | undefined
        description: string | null | undefined
        permalink: string | null | undefined
        created_time: string | null | undefined
        views: number | null | undefined
        likes: number | null | undefined
        comments: number | null | undefined
        synced_at: string | null | undefined
        created_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        external_id: string | undefined
        description: string | undefined
        permalink: string | undefined
        created_time: string | undefined
        views: number | undefined
        likes: number | undefined
        comments: number | undefined
        synced_at: string | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    Ga4Daily: {
      Row: {
        id: string | null
        tenant_id: string | null
        date: string | null
        source: string | null
        medium: string | null
        campaign: string | null
        landing_page: string | null
        device: string | null
        sessions: number | null
        active_users: number | null
        new_users: number | null
        conversions: number | string | null
        engaged_sessions: number | null
        synced_at: string | null
        created_at: string | null
        updated_at: string | null
      }
      Insert: {
        id: string | null | undefined
        tenant_id: string | null | undefined
        date: string | null | undefined
        source: string | null | undefined
        medium: string | null | undefined
        campaign: string | null | undefined
        landing_page: string | null | undefined
        device: string | null | undefined
        sessions: number | null | undefined
        active_users: number | null | undefined
        new_users: number | null | undefined
        conversions: number | string | null | undefined
        engaged_sessions: number | null | undefined
        synced_at: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        date: string | undefined
        source: string | undefined
        medium: string | undefined
        campaign: string | undefined
        landing_page: string | undefined
        device: string | undefined
        sessions: number | undefined
        active_users: number | undefined
        new_users: number | undefined
        conversions: number | string | undefined
        engaged_sessions: number | undefined
        synced_at: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    GoogleOauthConnections: {
      Row: {
        id: string | null
        tenant_id: string | null
        provider: string | null
        google_email: string | null
        refresh_token: string | null
        scopes: string | null
        ga4_property_id: string | null
        status: string | null
        last_sync_at: string | null
        last_error: string | null
        connected_by: string | null
        created_at: string | null
        updated_at: string | null
      }
      Insert: {
        id: string | null | undefined
        tenant_id: string | null | undefined
        provider: string | null | undefined
        google_email: string | null | undefined
        refresh_token: string | null | undefined
        scopes: string | null | undefined
        ga4_property_id: string | null | undefined
        status: string | null | undefined
        last_sync_at: string | null | undefined
        last_error: string | null | undefined
        connected_by: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        provider: string | undefined
        google_email: string | undefined
        refresh_token: string | undefined
        scopes: string | undefined
        ga4_property_id: string | undefined
        status: string | undefined
        last_sync_at: string | undefined
        last_error: string | undefined
        connected_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    GrowthContext: {
      Row: {
        tenant_id: string | null
        business_type: string | null
        offer_name: string | null
        offer_price_eur: number | string | null
        sales_cycle_days: number | null
        target_monthly_revenue_eur: number | string | null
        target_ltgp_cac: number | string | null
        target_cash_roas: number | string | null
        capacity_calls_per_week: number | null
        capacity_active_clients: number | null
        notes: string | null
        updated_by: string | null
        created_at: string | null
        updated_at: string | null
      }
      Insert: {
        tenant_id: string | null | undefined
        business_type: string | null | undefined
        offer_name: string | null | undefined
        offer_price_eur: number | string | null | undefined
        sales_cycle_days: number | null | undefined
        target_monthly_revenue_eur: number | string | null | undefined
        target_ltgp_cac: number | string | null | undefined
        target_cash_roas: number | string | null | undefined
        capacity_calls_per_week: number | null | undefined
        capacity_active_clients: number | null | undefined
        notes: string | null | undefined
        updated_by: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
      }
      Update: {
        tenant_id: string | undefined
        business_type: string | undefined
        offer_name: string | undefined
        offer_price_eur: number | string | undefined
        sales_cycle_days: number | undefined
        target_monthly_revenue_eur: number | string | undefined
        target_ltgp_cac: number | string | undefined
        target_cash_roas: number | string | undefined
        capacity_calls_per_week: number | undefined
        capacity_active_clients: number | undefined
        notes: string | undefined
        updated_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    IdentityMatches: {
      Row: {
        id: string | null
        event_id: string | null
        contact_id: string | null
        method: string | null
        confidence: number | string | null
        reason: string | null
        status: string | null
        evidence: Json | null
        reviewed_by: string | null
        reviewed_at: string | null
        created_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        event_id: string | null | undefined
        contact_id: string | null | undefined
        method: string | null | undefined
        confidence: number | string | null | undefined
        reason: string | null | undefined
        status: string | null | undefined
        evidence: Json | null | undefined
        reviewed_by: string | null | undefined
        reviewed_at: string | null | undefined
        created_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        event_id: string | undefined
        contact_id: string | undefined
        method: string | undefined
        confidence: number | string | undefined
        reason: string | undefined
        status: string | undefined
        evidence: Json | undefined
        reviewed_by: string | undefined
        reviewed_at: string | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    IgAccountDaily: {
      Row: {
        id: string | null
        snapshot_date: string | null
        followers_count: number | null
        media_count: number | null
        reach: number | null
        profile_views: number | null
        new_follows: number | null
        unfollows: number | null
        reach_followers: number | null
        reach_non_followers: number | null
        synced_at: string | null
        created_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        snapshot_date: string | null | undefined
        followers_count: number | null | undefined
        media_count: number | null | undefined
        reach: number | null | undefined
        profile_views: number | null | undefined
        new_follows: number | null | undefined
        unfollows: number | null | undefined
        reach_followers: number | null | undefined
        reach_non_followers: number | null | undefined
        synced_at: string | null | undefined
        created_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        snapshot_date: string | undefined
        followers_count: number | undefined
        media_count: number | undefined
        reach: number | undefined
        profile_views: number | undefined
        new_follows: number | undefined
        unfollows: number | undefined
        reach_followers: number | undefined
        reach_non_followers: number | undefined
        synced_at: string | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    IgAudience: {
      Row: {
        id: string | null
        dimension: string | null
        bucket: string | null
        value: number | null
        captured_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        dimension: string | null | undefined
        bucket: string | null | undefined
        value: number | null | undefined
        captured_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        dimension: string | undefined
        bucket: string | undefined
        value: number | undefined
        captured_at: string | undefined
        tenant_id: string | undefined
      }
    }
    IgComments: {
      Row: {
        id: string | null
        external_id: string | null
        media_external_id: string | null
        username: string | null
        text: string | null
        like_count: number | null
        commented_at: string | null
        synced_at: string | null
        created_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        external_id: string | null | undefined
        media_external_id: string | null | undefined
        username: string | null | undefined
        text: string | null | undefined
        like_count: number | null | undefined
        commented_at: string | null | undefined
        synced_at: string | null | undefined
        created_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        external_id: string | undefined
        media_external_id: string | undefined
        username: string | undefined
        text: string | undefined
        like_count: number | undefined
        commented_at: string | undefined
        synced_at: string | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    IgCompetitorMedia: {
      Row: {
        id: string | null
        competitor_id: string | null
        external_id: string | null
        caption: string | null
        media_type: string | null
        media_product_type: string | null
        like_count: number | null
        comments_count: number | null
        engagement_proxy: number | null
        permalink: string | null
        media_url: string | null
        thumbnail_url: string | null
        published_at: string | null
        transcript: string | null
        ai_analysis: Json | null
        synced_at: string | null
        created_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        competitor_id: string | null | undefined
        external_id: string | null | undefined
        caption: string | null | undefined
        media_type: string | null | undefined
        media_product_type: string | null | undefined
        like_count: number | null | undefined
        comments_count: number | null | undefined
        engagement_proxy: number | null | undefined
        permalink: string | null | undefined
        media_url: string | null | undefined
        thumbnail_url: string | null | undefined
        published_at: string | null | undefined
        transcript: string | null | undefined
        ai_analysis: Json | null | undefined
        synced_at: string | null | undefined
        created_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        competitor_id: string | undefined
        external_id: string | undefined
        caption: string | undefined
        media_type: string | undefined
        media_product_type: string | undefined
        like_count: number | undefined
        comments_count: number | undefined
        engagement_proxy: number | undefined
        permalink: string | undefined
        media_url: string | undefined
        thumbnail_url: string | undefined
        published_at: string | undefined
        transcript: string | undefined
        ai_analysis: Json | undefined
        synced_at: string | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    IgCompetitors: {
      Row: {
        id: string | null
        username: string | null
        followers_count: number | null
        media_count: number | null
        note: string | null
        last_synced_at: string | null
        created_by: string | null
        created_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        username: string | null | undefined
        followers_count: number | null | undefined
        media_count: number | null | undefined
        note: string | null | undefined
        last_synced_at: string | null | undefined
        created_by: string | null | undefined
        created_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        username: string | undefined
        followers_count: number | undefined
        media_count: number | undefined
        note: string | undefined
        last_synced_at: string | undefined
        created_by: string | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    IgConversationsDaily: {
      Row: {
        id: string | null
        snapshot_date: string | null
        total_conversations: number | null
        unread_conversations: number | null
        total_messages: number | null
        unique_people: number | null
        synced_at: string | null
        created_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        snapshot_date: string | null | undefined
        total_conversations: number | null | undefined
        unread_conversations: number | null | undefined
        total_messages: number | null | undefined
        unique_people: number | null | undefined
        synced_at: string | null | undefined
        created_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        snapshot_date: string | undefined
        total_conversations: number | undefined
        unread_conversations: number | undefined
        total_messages: number | undefined
        unique_people: number | undefined
        synced_at: string | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    IgMedia: {
      Row: {
        id: string | null
        external_id: string | null
        media_type: string | null
        media_product_type: string | null
        caption: string | null
        permalink: string | null
        thumbnail_url: string | null
        media_url: string | null
        published_at: string | null
        reach: number | null
        views: number | null
        likes: number | null
        comments: number | null
        shares: number | null
        saved: number | null
        total_interactions: number | null
        avg_watch_time: number | string | null
        reach_followers: number | null
        reach_non_followers: number | null
        follows: number | null
        engagement_rate: number | string | null
        transcript: string | null
        transcript_status: string | null
        ai_analysis: Json | null
        ai_analyzed_at: string | null
        synced_at: string | null
        created_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        external_id: string | null | undefined
        media_type: string | null | undefined
        media_product_type: string | null | undefined
        caption: string | null | undefined
        permalink: string | null | undefined
        thumbnail_url: string | null | undefined
        media_url: string | null | undefined
        published_at: string | null | undefined
        reach: number | null | undefined
        views: number | null | undefined
        likes: number | null | undefined
        comments: number | null | undefined
        shares: number | null | undefined
        saved: number | null | undefined
        total_interactions: number | null | undefined
        avg_watch_time: number | string | null | undefined
        reach_followers: number | null | undefined
        reach_non_followers: number | null | undefined
        follows: number | null | undefined
        engagement_rate: number | string | null | undefined
        transcript: string | null | undefined
        transcript_status: string | null | undefined
        ai_analysis: Json | null | undefined
        ai_analyzed_at: string | null | undefined
        synced_at: string | null | undefined
        created_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        external_id: string | undefined
        media_type: string | undefined
        media_product_type: string | undefined
        caption: string | undefined
        permalink: string | undefined
        thumbnail_url: string | undefined
        media_url: string | undefined
        published_at: string | undefined
        reach: number | undefined
        views: number | undefined
        likes: number | undefined
        comments: number | undefined
        shares: number | undefined
        saved: number | undefined
        total_interactions: number | undefined
        avg_watch_time: number | string | undefined
        reach_followers: number | undefined
        reach_non_followers: number | undefined
        follows: number | undefined
        engagement_rate: number | string | undefined
        transcript: string | undefined
        transcript_status: string | undefined
        ai_analysis: Json | undefined
        ai_analyzed_at: string | undefined
        synced_at: string | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    IntegrationSettings: {
      Row: {
        key: string | null
        value: string | null
        is_secret: boolean | null
        label: string | null
        updated_at: string | null
        updated_by: string | null
        tenant_id: string | null
      }
      Insert: {
        key: string | null | undefined
        value: string | null | undefined
        is_secret: boolean | null | undefined
        label: string | null | undefined
        updated_at: string | null | undefined
        updated_by: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        key: string | undefined
        value: string | undefined
        is_secret: boolean | undefined
        label: string | undefined
        updated_at: string | undefined
        updated_by: string | undefined
        tenant_id: string | undefined
      }
    }
    IntegrationSyncRuns: {
      Row: {
        id: string | null
        tenant_id: string | null
        provider: string | null
        job: string | null
        status: string | null
        trigger: string | null
        started_at: string | null
        finished_at: string | null
        rows_written: number | null
        error_code: string | null
        error_message: string | null
        detail: Json | null
        created_at: string | null
      }
      Insert: {
        id: string | null | undefined
        tenant_id: string | null | undefined
        provider: string | null | undefined
        job: string | null | undefined
        status: string | null | undefined
        trigger: string | null | undefined
        started_at: string | null | undefined
        finished_at: string | null | undefined
        rows_written: number | null | undefined
        error_code: string | null | undefined
        error_message: string | null | undefined
        detail: Json | null | undefined
        created_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        provider: string | undefined
        job: string | undefined
        status: string | undefined
        trigger: string | undefined
        started_at: string | undefined
        finished_at: string | undefined
        rows_written: number | undefined
        error_code: string | undefined
        error_message: string | undefined
        detail: Json | undefined
        created_at: string | undefined
      }
    }
    KpiDailyReports: {
      Row: {
        id: string | null
        user_id: string | null
        role_key: string | null
        report_date: string | null
        data: Json | null
        submitted_at: string | null
        created_at: string | null
        updated_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        user_id: string | null | undefined
        role_key: string | null | undefined
        report_date: string | null | undefined
        data: Json | null | undefined
        submitted_at: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        user_id: string | undefined
        role_key: string | undefined
        report_date: string | undefined
        data: Json | undefined
        submitted_at: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    KpiFormTemplates: {
      Row: {
        id: string | null
        role_key: string | null
        field_key: string | null
        field_label: string | null
        field_type: string | null
        placeholder: string | null
        help_text: string | null
        is_required: boolean | null
        is_active: boolean | null
        sort_order: number | null
        select_options: Json | null
        default_value: Json | null
        created_at: string | null
        updated_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        role_key: string | null | undefined
        field_key: string | null | undefined
        field_label: string | null | undefined
        field_type: string | null | undefined
        placeholder: string | null | undefined
        help_text: string | null | undefined
        is_required: boolean | null | undefined
        is_active: boolean | null | undefined
        sort_order: number | null | undefined
        select_options: Json | null | undefined
        default_value: Json | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        role_key: string | undefined
        field_key: string | undefined
        field_label: string | undefined
        field_type: string | undefined
        placeholder: string | undefined
        help_text: string | undefined
        is_required: boolean | undefined
        is_active: boolean | undefined
        sort_order: number | undefined
        select_options: Json | undefined
        default_value: Json | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    LinkTemplates: {
      Row: {
        id: string | null
        name: string | null
        base_url: string | null
        applies_to: string | null
        is_active: boolean | null
        created_by: string | null
        created_at: string | null
        updated_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        name: string | null | undefined
        base_url: string | null | undefined
        applies_to: string | null | undefined
        is_active: boolean | null | undefined
        created_by: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        name: string | undefined
        base_url: string | undefined
        applies_to: string | undefined
        is_active: boolean | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    ManualPlatformRecords: {
      Row: {
        id: string | null
        tenant_id: string | null
        platform: string | null
        reference: string | null
        amount: number | string | null
        transacted_at: string | null
        notes: string | null
        matched_collection_id: string | null
        created_by: string | null
        created_at: string | null
      }
      Insert: {
        id: string | null | undefined
        tenant_id: string | null | undefined
        platform: string | null | undefined
        reference: string | null | undefined
        amount: number | string | null | undefined
        transacted_at: string | null | undefined
        notes: string | null | undefined
        matched_collection_id: string | null | undefined
        created_by: string | null | undefined
        created_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        platform: string | undefined
        reference: string | undefined
        amount: number | string | undefined
        transacted_at: string | undefined
        notes: string | undefined
        matched_collection_id: string | undefined
        created_by: string | undefined
        created_at: string | undefined
      }
    }
    Partners: {
      Row: {
        id: string | null
        tenant_id: string | null
        name: string | null
        profit_percent: number | string | null
        notes: string | null
        is_active: boolean | null
        created_at: string | null
        updated_at: string | null
      }
      Insert: {
        id: string | null | undefined
        tenant_id: string | null | undefined
        name: string | null | undefined
        profit_percent: number | string | null | undefined
        notes: string | null | undefined
        is_active: boolean | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        name: string | undefined
        profit_percent: number | string | undefined
        notes: string | undefined
        is_active: boolean | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    PaymentFollowUps: {
      Row: {
        id: string | null
        sale_id: string | null
        note: string | null
        created_by: string | null
        created_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        sale_id: string | null | undefined
        note: string | null | undefined
        created_by: string | null | undefined
        created_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        sale_id: string | undefined
        note: string | undefined
        created_by: string | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    PaymentPlans: {
      Row: {
        id: string | null
        product_id: string | null
        name: string | null
        code: string | null
        gross_price: number | string | null
        number_of_payments: number | null
        financing_provider: string | null
        cash_collection_ratio: number | string | null
        is_active: boolean | null
        sort_order: number | null
        created_at: string | null
        updated_at: string | null
        method: string | null
        fee_percent: number | string | null
        financing_surcharge_percent: number | string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        product_id: string | null | undefined
        name: string | null | undefined
        code: string | null | undefined
        gross_price: number | string | null | undefined
        number_of_payments: number | null | undefined
        financing_provider: string | null | undefined
        cash_collection_ratio: number | string | null | undefined
        is_active: boolean | null | undefined
        sort_order: number | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        method: string | null | undefined
        fee_percent: number | string | null | undefined
        financing_surcharge_percent: number | string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        product_id: string | undefined
        name: string | undefined
        code: string | undefined
        gross_price: number | string | undefined
        number_of_payments: number | undefined
        financing_provider: string | undefined
        cash_collection_ratio: number | string | undefined
        is_active: boolean | undefined
        sort_order: number | undefined
        created_at: string | undefined
        updated_at: string | undefined
        method: string | undefined
        fee_percent: number | string | undefined
        financing_surcharge_percent: number | string | undefined
        tenant_id: string | undefined
      }
    }
    PositiveNotes: {
      Row: {
        id: string | null
        user_id: string | null
        period_type: string | null
        period_key: string | null
        content: string | null
        is_shared: boolean | null
        created_at: string | null
        updated_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        user_id: string | null | undefined
        period_type: string | null | undefined
        period_key: string | null | undefined
        content: string | null | undefined
        is_shared: boolean | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        user_id: string | undefined
        period_type: string | undefined
        period_key: string | undefined
        content: string | undefined
        is_shared: boolean | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    ProductExtras: {
      Row: {
        id: string | null
        name: string | null
        description: string | null
        is_active: boolean | null
        sort_order: number | null
        created_at: string | null
        updated_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        name: string | null | undefined
        description: string | null | undefined
        is_active: boolean | null | undefined
        sort_order: number | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        name: string | undefined
        description: string | undefined
        is_active: boolean | undefined
        sort_order: number | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    Products: {
      Row: {
        id: string | null
        name: string | null
        description: string | null
        is_active: boolean | null
        created_at: string | null
        updated_at: string | null
        level: number | null
        next_product_id: string | null
        max_capacity: number | null
        duration_months: number | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        name: string | null | undefined
        description: string | null | undefined
        is_active: boolean | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        level: number | null | undefined
        next_product_id: string | null | undefined
        max_capacity: number | null | undefined
        duration_months: number | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        name: string | undefined
        description: string | undefined
        is_active: boolean | undefined
        created_at: string | undefined
        updated_at: string | undefined
        level: number | undefined
        next_product_id: string | undefined
        max_capacity: number | undefined
        duration_months: number | undefined
        tenant_id: string | undefined
      }
    }
    QualificationQuestions: {
      Row: {
        id: string | null
        slug: string | null
        question_text: string | null
        field_key: string | null
        first_seen_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        slug: string | null | undefined
        question_text: string | null | undefined
        field_key: string | null | undefined
        first_seen_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        slug: string | undefined
        question_text: string | undefined
        field_key: string | undefined
        first_seen_at: string | undefined
        tenant_id: string | undefined
      }
    }
    RawEvents: {
      Row: {
        id: string | null
        tenant_id: string | null
        site_id: string | null
        source: string | null
        source_event_id: string | null
        source_schema_version: string | null
        normalizer_version: string | null
        received_at: string | null
        processed_at: string | null
        payload: Json | null
        payload_bytes: number | null
        processing_status: string | null
        rejection_reason: string | null
        canonical_event_id: string | null
        request_origin: string | null
        user_agent: string | null
        ip_hash: string | null
        bot_classification: string | null
        bot_reason: string | null
        correlation_id: string | null
        created_at: string | null
      }
      Insert: {
        id: string | null | undefined
        tenant_id: string | null | undefined
        site_id: string | null | undefined
        source: string | null | undefined
        source_event_id: string | null | undefined
        source_schema_version: string | null | undefined
        normalizer_version: string | null | undefined
        received_at: string | null | undefined
        processed_at: string | null | undefined
        payload: Json | null | undefined
        payload_bytes: number | null | undefined
        processing_status: string | null | undefined
        rejection_reason: string | null | undefined
        canonical_event_id: string | null | undefined
        request_origin: string | null | undefined
        user_agent: string | null | undefined
        ip_hash: string | null | undefined
        bot_classification: string | null | undefined
        bot_reason: string | null | undefined
        correlation_id: string | null | undefined
        created_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        site_id: string | undefined
        source: string | undefined
        source_event_id: string | undefined
        source_schema_version: string | undefined
        normalizer_version: string | undefined
        received_at: string | undefined
        processed_at: string | undefined
        payload: Json | undefined
        payload_bytes: number | undefined
        processing_status: string | undefined
        rejection_reason: string | undefined
        canonical_event_id: string | undefined
        request_origin: string | undefined
        user_agent: string | undefined
        ip_hash: string | undefined
        bot_classification: string | undefined
        bot_reason: string | undefined
        correlation_id: string | undefined
        created_at: string | undefined
      }
    }
    ReelDrafts: {
      Row: {
        id: string | null
        source_media_id: string | null
        source_permalink: string | null
        source_account: string | null
        thumbnail_url: string | null
        caption: string | null
        transcript: string | null
        adapted_script: string | null
        carousel_idea: string | null
        status: string | null
        gen_error: string | null
        created_at: string | null
        draft_day: string | null
        created_by: string | null
        testimonio_id: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        source_media_id: string | null | undefined
        source_permalink: string | null | undefined
        source_account: string | null | undefined
        thumbnail_url: string | null | undefined
        caption: string | null | undefined
        transcript: string | null | undefined
        adapted_script: string | null | undefined
        carousel_idea: string | null | undefined
        status: string | null | undefined
        gen_error: string | null | undefined
        created_at: string | null | undefined
        draft_day: string | null | undefined
        created_by: string | null | undefined
        testimonio_id: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        source_media_id: string | undefined
        source_permalink: string | undefined
        source_account: string | undefined
        thumbnail_url: string | undefined
        caption: string | undefined
        transcript: string | undefined
        adapted_script: string | undefined
        carousel_idea: string | undefined
        status: string | undefined
        gen_error: string | undefined
        created_at: string | undefined
        draft_day: string | undefined
        created_by: string | undefined
        testimonio_id: string | undefined
        tenant_id: string | undefined
      }
    }
    Refunds: {
      Row: {
        id: string | null
        sale_id: string | null
        collection_id: string | null
        refund_date: string | null
        gross_refund_amount: number | string | null
        commissionable_refund_amount: number | string | null
        reason: string | null
        status: string | null
        created_by: string | null
        notes: string | null
        created_at: string | null
        updated_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        sale_id: string | null | undefined
        collection_id: string | null | undefined
        refund_date: string | null | undefined
        gross_refund_amount: number | string | null | undefined
        commissionable_refund_amount: number | string | null | undefined
        reason: string | null | undefined
        status: string | null | undefined
        created_by: string | null | undefined
        notes: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        sale_id: string | undefined
        collection_id: string | undefined
        refund_date: string | undefined
        gross_refund_amount: number | string | undefined
        commissionable_refund_amount: number | string | undefined
        reason: string | undefined
        status: string | undefined
        created_by: string | undefined
        notes: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    ResourceLinkDivisions: {
      Row: {
        id: string | null
        name: string | null
        sort_order: number | null
        created_by: string | null
        created_at: string | null
        updated_at: string | null
      }
      Insert: {
        id: string | null | undefined
        name: string | null | undefined
        sort_order: number | null | undefined
        created_by: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        name: string | undefined
        sort_order: number | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    ResourceLinks: {
      Row: {
        id: string | null
        category: string | null
        name: string | null
        url: string | null
        description: string | null
        applies_to: string | null
        is_active: boolean | null
        sort_order: number | null
        created_by: string | null
        created_at: string | null
        updated_at: string | null
        division_id: string | null
      }
      Insert: {
        id: string | null | undefined
        category: string | null | undefined
        name: string | null | undefined
        url: string | null | undefined
        description: string | null | undefined
        applies_to: string | null | undefined
        is_active: boolean | null | undefined
        sort_order: number | null | undefined
        created_by: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        division_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        category: string | undefined
        name: string | undefined
        url: string | undefined
        description: string | undefined
        applies_to: string | undefined
        is_active: boolean | undefined
        sort_order: number | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        division_id: string | undefined
      }
    }
    Roleplays: {
      Row: {
        id: string | null
        title: string | null
        description: string | null
        participant_id: string | null
        participant_name: string | null
        recording_url: string | null
        transcript_url: string | null
        transcript: string | null
        score: number | string | null
        notes: string | null
        shared: boolean | null
        created_by: string | null
        created_at: string | null
        updated_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        title: string | null | undefined
        description: string | null | undefined
        participant_id: string | null | undefined
        participant_name: string | null | undefined
        recording_url: string | null | undefined
        transcript_url: string | null | undefined
        transcript: string | null | undefined
        score: number | string | null | undefined
        notes: string | null | undefined
        shared: boolean | null | undefined
        created_by: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        title: string | undefined
        description: string | undefined
        participant_id: string | undefined
        participant_name: string | undefined
        recording_url: string | undefined
        transcript_url: string | undefined
        transcript: string | undefined
        score: number | string | undefined
        notes: string | undefined
        shared: boolean | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    Roles: {
      Row: {
        id: string | null
        key: string | null
        name: string | null
        description: string | null
        created_at: string | null
      }
      Insert: {
        id: string | null | undefined
        key: string | null | undefined
        name: string | null | undefined
        description: string | null | undefined
        created_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        key: string | undefined
        name: string | undefined
        description: string | undefined
        created_at: string | undefined
      }
    }
    SaleExpectedInstallments: {
      Row: {
        id: string | null
        sale_id: string | null
        installment_number: number | null
        due_date: string | null
        expected_gross_amount: number | string | null
        expected_commissionable_amount: number | string | null
        status: string | null
        created_at: string | null
        updated_at: string | null
        flagged_delinquent: boolean | null
        reminder_count: number | null
        last_reminder_at: string | null
        tenant_id: string | null
        is_monitoring: boolean | null
      }
      Insert: {
        id: string | null | undefined
        sale_id: string | null | undefined
        installment_number: number | null | undefined
        due_date: string | null | undefined
        expected_gross_amount: number | string | null | undefined
        expected_commissionable_amount: number | string | null | undefined
        status: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        flagged_delinquent: boolean | null | undefined
        reminder_count: number | null | undefined
        last_reminder_at: string | null | undefined
        tenant_id: string | null | undefined
        is_monitoring: boolean | null | undefined
      }
      Update: {
        id: string | undefined
        sale_id: string | undefined
        installment_number: number | undefined
        due_date: string | undefined
        expected_gross_amount: number | string | undefined
        expected_commissionable_amount: number | string | undefined
        status: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        flagged_delinquent: boolean | undefined
        reminder_count: number | undefined
        last_reminder_at: string | undefined
        tenant_id: string | undefined
        is_monitoring: boolean | undefined
      }
    }
    Sales: {
      Row: {
        id: string | null
        contact_id: string | null
        appointment_id: string | null
        product_id: string | null
        payment_plan_id: string | null
        sale_date: string | null
        refund_deadline_at: string | null
        gross_amount: number | string | null
        expected_commissionable_amount: number | string | null
        setter_id: string | null
        closer_id: string | null
        affiliate_id: string | null
        affiliate_commission_percent: number | string | null
        status: string | null
        created_by: string | null
        updated_by: string | null
        notes: string | null
        created_at: string | null
        updated_at: string | null
        cash_day1: number | string | null
        is_upsell: boolean | null
        origin_sale_id: string | null
        from_follow_up: boolean | null
        discount: number | string | null
        processing_fee: number | string | null
        onboarding_date: string | null
        first_coaching_date: string | null
        graduation_date: string | null
        reservation_amount: number | string | null
        converted_from_reservation_id: string | null
        down_payment_amount: number | string | null
        installments_start_date: string | null
        installments_count: number | null
        reservation_completed_at: string | null
        payment_method: string | null
        payment_proof_url: string | null
        custom_plan: Json | null
        extras: string | null
        buyer_is_scheduler: boolean | null
        payer_data: Json | null
        access_email: string | null
        onboarding_scheduled_at: string | null
        onboarding_session_at: string | null
        documents_verified: boolean | null
        documents_verified_at: string | null
        documents_verified_by: string | null
        documents_verified_override: boolean | null
        documents_override_reason: string | null
        documents_override_by: string | null
        documents_override_at: string | null
        course_access_granted_at: string | null
        course_access_revoked_at: string | null
        student_document_type: string | null
        student_document_number: string | null
        tenant_id: string | null
        payment_proof_path: string | null
      }
      Insert: {
        id: string | null | undefined
        contact_id: string | null | undefined
        appointment_id: string | null | undefined
        product_id: string | null | undefined
        payment_plan_id: string | null | undefined
        sale_date: string | null | undefined
        refund_deadline_at: string | null | undefined
        gross_amount: number | string | null | undefined
        expected_commissionable_amount: number | string | null | undefined
        setter_id: string | null | undefined
        closer_id: string | null | undefined
        affiliate_id: string | null | undefined
        affiliate_commission_percent: number | string | null | undefined
        status: string | null | undefined
        created_by: string | null | undefined
        updated_by: string | null | undefined
        notes: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        cash_day1: number | string | null | undefined
        is_upsell: boolean | null | undefined
        origin_sale_id: string | null | undefined
        from_follow_up: boolean | null | undefined
        discount: number | string | null | undefined
        processing_fee: number | string | null | undefined
        onboarding_date: string | null | undefined
        first_coaching_date: string | null | undefined
        graduation_date: string | null | undefined
        reservation_amount: number | string | null | undefined
        converted_from_reservation_id: string | null | undefined
        down_payment_amount: number | string | null | undefined
        installments_start_date: string | null | undefined
        installments_count: number | null | undefined
        reservation_completed_at: string | null | undefined
        payment_method: string | null | undefined
        payment_proof_url: string | null | undefined
        custom_plan: Json | null | undefined
        extras: string | null | undefined
        buyer_is_scheduler: boolean | null | undefined
        payer_data: Json | null | undefined
        access_email: string | null | undefined
        onboarding_scheduled_at: string | null | undefined
        onboarding_session_at: string | null | undefined
        documents_verified: boolean | null | undefined
        documents_verified_at: string | null | undefined
        documents_verified_by: string | null | undefined
        documents_verified_override: boolean | null | undefined
        documents_override_reason: string | null | undefined
        documents_override_by: string | null | undefined
        documents_override_at: string | null | undefined
        course_access_granted_at: string | null | undefined
        course_access_revoked_at: string | null | undefined
        student_document_type: string | null | undefined
        student_document_number: string | null | undefined
        tenant_id: string | null | undefined
        payment_proof_path: string | null | undefined
      }
      Update: {
        id: string | undefined
        contact_id: string | undefined
        appointment_id: string | undefined
        product_id: string | undefined
        payment_plan_id: string | undefined
        sale_date: string | undefined
        refund_deadline_at: string | undefined
        gross_amount: number | string | undefined
        expected_commissionable_amount: number | string | undefined
        setter_id: string | undefined
        closer_id: string | undefined
        affiliate_id: string | undefined
        affiliate_commission_percent: number | string | undefined
        status: string | undefined
        created_by: string | undefined
        updated_by: string | undefined
        notes: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        cash_day1: number | string | undefined
        is_upsell: boolean | undefined
        origin_sale_id: string | undefined
        from_follow_up: boolean | undefined
        discount: number | string | undefined
        processing_fee: number | string | undefined
        onboarding_date: string | undefined
        first_coaching_date: string | undefined
        graduation_date: string | undefined
        reservation_amount: number | string | undefined
        converted_from_reservation_id: string | undefined
        down_payment_amount: number | string | undefined
        installments_start_date: string | undefined
        installments_count: number | undefined
        reservation_completed_at: string | undefined
        payment_method: string | undefined
        payment_proof_url: string | undefined
        custom_plan: Json | undefined
        extras: string | undefined
        buyer_is_scheduler: boolean | undefined
        payer_data: Json | undefined
        access_email: string | undefined
        onboarding_scheduled_at: string | undefined
        onboarding_session_at: string | undefined
        documents_verified: boolean | undefined
        documents_verified_at: string | undefined
        documents_verified_by: string | undefined
        documents_verified_override: boolean | undefined
        documents_override_reason: string | undefined
        documents_override_by: string | undefined
        documents_override_at: string | undefined
        course_access_granted_at: string | undefined
        course_access_revoked_at: string | undefined
        student_document_type: string | undefined
        student_document_number: string | undefined
        tenant_id: string | undefined
        payment_proof_path: string | undefined
      }
    }
    SalesTramos: {
      Row: {
        id: string | null
        name: string | null
        threshold: number | string | null
        emoji: string | null
        color: string | null
        reward: string | null
        sort_order: number | null
        is_active: boolean | null
        created_at: string | null
        updated_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        name: string | null | undefined
        threshold: number | string | null | undefined
        emoji: string | null | undefined
        color: string | null | undefined
        reward: string | null | undefined
        sort_order: number | null | undefined
        is_active: boolean | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        name: string | undefined
        threshold: number | string | undefined
        emoji: string | undefined
        color: string | undefined
        reward: string | undefined
        sort_order: number | undefined
        is_active: boolean | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    SalesTramosConfig: {
      Row: {
        id: number | null
        metric: string | null
        period: string | null
        updated_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: number | null | undefined
        metric: string | null | undefined
        period: string | null | undefined
        updated_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: number | undefined
        metric: string | undefined
        period: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    SavedDashboardViews: {
      Row: {
        id: string | null
        user_id: string | null
        name: string | null
        scope: string | null
        filters: Json | null
        widgets: Json | null
        created_at: string | null
        updated_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        user_id: string | null | undefined
        name: string | null | undefined
        scope: string | null | undefined
        filters: Json | null | undefined
        widgets: Json | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        user_id: string | undefined
        name: string | undefined
        scope: string | undefined
        filters: Json | undefined
        widgets: Json | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    SequraDelinquentCustomers: {
      Row: {
        id: string | null
        order_reference: string | null
        merchant_reference: string | null
        customer_name: string | null
        customer_email: string | null
        product_name: string | null
        order_value: number | string | null
        debt_amount: number | string | null
        overdue_days: number | null
        overdue_since: string | null
        status: string | null
        notes: string | null
        last_synced_at: string | null
        created_at: string | null
        updated_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        order_reference: string | null | undefined
        merchant_reference: string | null | undefined
        customer_name: string | null | undefined
        customer_email: string | null | undefined
        product_name: string | null | undefined
        order_value: number | string | null | undefined
        debt_amount: number | string | null | undefined
        overdue_days: number | null | undefined
        overdue_since: string | null | undefined
        status: string | null | undefined
        notes: string | null | undefined
        last_synced_at: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        order_reference: string | undefined
        merchant_reference: string | undefined
        customer_name: string | undefined
        customer_email: string | undefined
        product_name: string | undefined
        order_value: number | string | undefined
        debt_amount: number | string | undefined
        overdue_days: number | undefined
        overdue_since: string | undefined
        status: string | undefined
        notes: string | undefined
        last_synced_at: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    StripeCustomers: {
      Row: {
        id: string | null
        tenant_id: string | null
        contact_id: string | null
        stripe_customer_id: string | null
        email: string | null
        name: string | null
        status: string | null
        subscription_id: string | null
        current_period_end: string | null
        last_synced_at: string | null
        created_at: string | null
        updated_at: string | null
      }
      Insert: {
        id: string | null | undefined
        tenant_id: string | null | undefined
        contact_id: string | null | undefined
        stripe_customer_id: string | null | undefined
        email: string | null | undefined
        name: string | null | undefined
        status: string | null | undefined
        subscription_id: string | null | undefined
        current_period_end: string | null | undefined
        last_synced_at: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        contact_id: string | undefined
        stripe_customer_id: string | undefined
        email: string | undefined
        name: string | undefined
        status: string | undefined
        subscription_id: string | undefined
        current_period_end: string | undefined
        last_synced_at: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    StripePayments: {
      Row: {
        id: string | null
        tenant_id: string | null
        payment_id: string | null
        charge_id: string | null
        customer_id: string | null
        customer_email: string | null
        amount: number | string | null
        refunded_amount: number | string | null
        currency: string | null
        status: string | null
        paid_at: string | null
        metadata: Json | null
        synced_at: string | null
        created_at: string | null
        updated_at: string | null
        stripe_fee: number | string | null
      }
      Insert: {
        id: string | null | undefined
        tenant_id: string | null | undefined
        payment_id: string | null | undefined
        charge_id: string | null | undefined
        customer_id: string | null | undefined
        customer_email: string | null | undefined
        amount: number | string | null | undefined
        refunded_amount: number | string | null | undefined
        currency: string | null | undefined
        status: string | null | undefined
        paid_at: string | null | undefined
        metadata: Json | null | undefined
        synced_at: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        stripe_fee: number | string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        payment_id: string | undefined
        charge_id: string | undefined
        customer_id: string | undefined
        customer_email: string | undefined
        amount: number | string | undefined
        refunded_amount: number | string | undefined
        currency: string | undefined
        status: string | undefined
        paid_at: string | undefined
        metadata: Json | undefined
        synced_at: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        stripe_fee: number | string | undefined
      }
    }
    Suggestions: {
      Row: {
        id: string | null
        user_id: string | null
        type: string | null
        title: string | null
        message: string | null
        status: string | null
        admin_notes: string | null
        page_url: string | null
        created_at: string | null
        updated_at: string | null
        resolved_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        user_id: string | null | undefined
        type: string | null | undefined
        title: string | null | undefined
        message: string | null | undefined
        status: string | null | undefined
        admin_notes: string | null | undefined
        page_url: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        resolved_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        user_id: string | undefined
        type: string | undefined
        title: string | undefined
        message: string | undefined
        status: string | undefined
        admin_notes: string | undefined
        page_url: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        resolved_at: string | undefined
        tenant_id: string | undefined
      }
    }
    Targets: {
      Row: {
        id: string | null
        name: string | null
        scope_type: string | null
        scope_user_id: string | null
        scope_role_key: string | null
        metric_key: string | null
        period_type: string | null
        period_start: string | null
        period_end: string | null
        target_value: number | string | null
        is_active: boolean | null
        created_by: string | null
        created_at: string | null
        updated_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        name: string | null | undefined
        scope_type: string | null | undefined
        scope_user_id: string | null | undefined
        scope_role_key: string | null | undefined
        metric_key: string | null | undefined
        period_type: string | null | undefined
        period_start: string | null | undefined
        period_end: string | null | undefined
        target_value: number | string | null | undefined
        is_active: boolean | null | undefined
        created_by: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        name: string | undefined
        scope_type: string | undefined
        scope_user_id: string | undefined
        scope_role_key: string | undefined
        metric_key: string | undefined
        period_type: string | undefined
        period_start: string | undefined
        period_end: string | undefined
        target_value: number | string | undefined
        is_active: boolean | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    Tasks: {
      Row: {
        id: string | null
        title: string | null
        description: string | null
        assignee_id: string | null
        status: string | null
        stage: string | null
        notes: string | null
        due_date: string | null
        source: string | null
        is_proposal: boolean | null
        created_by: string | null
        created_at: string | null
        updated_at: string | null
        priority: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        title: string | null | undefined
        description: string | null | undefined
        assignee_id: string | null | undefined
        status: string | null | undefined
        stage: string | null | undefined
        notes: string | null | undefined
        due_date: string | null | undefined
        source: string | null | undefined
        is_proposal: boolean | null | undefined
        created_by: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        priority: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        title: string | undefined
        description: string | undefined
        assignee_id: string | undefined
        status: string | undefined
        stage: string | undefined
        notes: string | undefined
        due_date: string | undefined
        source: string | undefined
        is_proposal: boolean | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        priority: string | undefined
        tenant_id: string | undefined
      }
    }
    TenantMembers: {
      Row: {
        id: string | null
        tenant_id: string | null
        user_id: string | null
        role: string | null
        created_at: string | null
      }
      Insert: {
        id: string | null | undefined
        tenant_id: string | null | undefined
        user_id: string | null | undefined
        role: string | null | undefined
        created_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        user_id: string | undefined
        role: string | undefined
        created_at: string | undefined
      }
    }
    Tenants: {
      Row: {
        id: string | null
        slug: string | null
        name: string | null
        status: string | null
        settings: Json | null
        created_at: string | null
      }
      Insert: {
        id: string | null | undefined
        slug: string | null | undefined
        name: string | null | undefined
        status: string | null | undefined
        settings: Json | null | undefined
        created_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        slug: string | undefined
        name: string | undefined
        status: string | undefined
        settings: Json | undefined
        created_at: string | undefined
      }
    }
    Testimonios: {
      Row: {
        id: string | null
        slug: string | null
        name: string | null
        kind: string | null
        avatar: string | null
        sector: string | null
        photo_url: string | null
        youtube_url: string | null
        hook: string | null
        punto_a: string | null
        punto_b: string | null
        vehiculo: string | null
        cifra: string | null
        has_revenue: boolean | null
        consent: boolean | null
        sort_order: number | null
        active: boolean | null
        created_at: string | null
        updated_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        slug: string | null | undefined
        name: string | null | undefined
        kind: string | null | undefined
        avatar: string | null | undefined
        sector: string | null | undefined
        photo_url: string | null | undefined
        youtube_url: string | null | undefined
        hook: string | null | undefined
        punto_a: string | null | undefined
        punto_b: string | null | undefined
        vehiculo: string | null | undefined
        cifra: string | null | undefined
        has_revenue: boolean | null | undefined
        consent: boolean | null | undefined
        sort_order: number | null | undefined
        active: boolean | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        slug: string | undefined
        name: string | undefined
        kind: string | undefined
        avatar: string | undefined
        sector: string | undefined
        photo_url: string | undefined
        youtube_url: string | undefined
        hook: string | undefined
        punto_a: string | undefined
        punto_b: string | undefined
        vehiculo: string | undefined
        cifra: string | undefined
        has_revenue: boolean | undefined
        consent: boolean | undefined
        sort_order: number | undefined
        active: boolean | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    TrackingSites: {
      Row: {
        id: string | null
        tenant_id: string | null
        slug: string | null
        name: string | null
        public_key: string | null
        allowed_origins: string | null
        allow_localhost: boolean | null
        tracking_enabled: boolean | null
        consent_default: string | null
        rate_limit_per_minute: number | null
        created_at: string | null
        updated_at: string | null
      }
      Insert: {
        id: string | null | undefined
        tenant_id: string | null | undefined
        slug: string | null | undefined
        name: string | null | undefined
        public_key: string | null | undefined
        allowed_origins: string | null | undefined
        allow_localhost: boolean | null | undefined
        tracking_enabled: boolean | null | undefined
        consent_default: string | null | undefined
        rate_limit_per_minute: number | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        slug: string | undefined
        name: string | undefined
        public_key: string | undefined
        allowed_origins: string | undefined
        allow_localhost: boolean | undefined
        tracking_enabled: boolean | undefined
        consent_default: string | undefined
        rate_limit_per_minute: number | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    Users: {
      Row: {
        id: string | null
        full_name: string | null
        email: string | null
        phone: string | null
        role_id: string | null
        is_active: boolean | null
        default_affiliate_commission_percent: number | string | null
        avatar_url: string | null
        created_at: string | null
        updated_at: string | null
        data_scope: string | null
        start_date: string | null
        base_salary: number | string | null
        commission_percent: number | string | null
        monthly_goal: number | string | null
        assigned_channel: string | null
        member_status: string | null
        affiliate_code: string | null
        dept_overrides: string | null
        tracking_code: string | null
        dni: string | null
        address: string | null
        personal_email: string | null
        calendly_email: string | null
        page_overrides: string | null
        fijo_min_sales: number | null
        fijo_unlock_type: string | null
        fijo_min_revenue: number | string | null
      }
      Insert: {
        id: string | null | undefined
        full_name: string | null | undefined
        email: string | null | undefined
        phone: string | null | undefined
        role_id: string | null | undefined
        is_active: boolean | null | undefined
        default_affiliate_commission_percent: number | string | null | undefined
        avatar_url: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        data_scope: string | null | undefined
        start_date: string | null | undefined
        base_salary: number | string | null | undefined
        commission_percent: number | string | null | undefined
        monthly_goal: number | string | null | undefined
        assigned_channel: string | null | undefined
        member_status: string | null | undefined
        affiliate_code: string | null | undefined
        dept_overrides: string | null | undefined
        tracking_code: string | null | undefined
        dni: string | null | undefined
        address: string | null | undefined
        personal_email: string | null | undefined
        calendly_email: string | null | undefined
        page_overrides: string | null | undefined
        fijo_min_sales: number | null | undefined
        fijo_unlock_type: string | null | undefined
        fijo_min_revenue: number | string | null | undefined
      }
      Update: {
        id: string | undefined
        full_name: string | undefined
        email: string | undefined
        phone: string | undefined
        role_id: string | undefined
        is_active: boolean | undefined
        default_affiliate_commission_percent: number | string | undefined
        avatar_url: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        data_scope: string | undefined
        start_date: string | undefined
        base_salary: number | string | undefined
        commission_percent: number | string | undefined
        monthly_goal: number | string | undefined
        assigned_channel: string | undefined
        member_status: string | undefined
        affiliate_code: string | undefined
        dept_overrides: string | undefined
        tracking_code: string | undefined
        dni: string | undefined
        address: string | undefined
        personal_email: string | undefined
        calendly_email: string | undefined
        page_overrides: string | undefined
        fijo_min_sales: number | undefined
        fijo_unlock_type: string | undefined
        fijo_min_revenue: number | string | undefined
      }
    }
    VslSessions: {
      Row: {
        id: string | null
        video_id: string | null
        anon_id: string | null
        lead_email: string | null
        lead_name: string | null
        referrer: string | null
        device: string | null
        country: string | null
        user_agent: string | null
        duration: number | string | null
        max_position: number | string | null
        watched_seconds: string | null
        plays: number | null
        reached_end: boolean | null
        first_play_at: string | null
        last_beat_at: string | null
        created_at: string | null
        updated_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        video_id: string | null | undefined
        anon_id: string | null | undefined
        lead_email: string | null | undefined
        lead_name: string | null | undefined
        referrer: string | null | undefined
        device: string | null | undefined
        country: string | null | undefined
        user_agent: string | null | undefined
        duration: number | string | null | undefined
        max_position: number | string | null | undefined
        watched_seconds: string | null | undefined
        plays: number | null | undefined
        reached_end: boolean | null | undefined
        first_play_at: string | null | undefined
        last_beat_at: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        video_id: string | undefined
        anon_id: string | undefined
        lead_email: string | undefined
        lead_name: string | undefined
        referrer: string | undefined
        device: string | undefined
        country: string | undefined
        user_agent: string | undefined
        duration: number | string | undefined
        max_position: number | string | undefined
        watched_seconds: string | undefined
        plays: number | undefined
        reached_end: boolean | undefined
        first_play_at: string | undefined
        last_beat_at: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    VslVideos: {
      Row: {
        id: string | null
        slug: string | null
        name: string | null
        source_url: string | null
        poster_url: string | null
        duration_seconds: number | string | null
        config: Json | null
        created_at: string | null
        updated_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        slug: string | null | undefined
        name: string | null | undefined
        source_url: string | null | undefined
        poster_url: string | null | undefined
        duration_seconds: number | string | null | undefined
        config: Json | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        slug: string | undefined
        name: string | undefined
        source_url: string | undefined
        poster_url: string | undefined
        duration_seconds: number | string | undefined
        config: Json | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    YoutubeUploads: {
      Row: {
        id: string | null
        ig_media_external_id: string | null
        youtube_video_id: string | null
        status: string | null
        error: string | null
        created_at: string | null
        updated_at: string | null
        views: number | string | null
        likes: number | string | null
        comments: number | string | null
        stats_synced_at: string | null
        tenant_id: string | null
      }
      Insert: {
        id: string | null | undefined
        ig_media_external_id: string | null | undefined
        youtube_video_id: string | null | undefined
        status: string | null | undefined
        error: string | null | undefined
        created_at: string | null | undefined
        updated_at: string | null | undefined
        views: number | string | null | undefined
        likes: number | string | null | undefined
        comments: number | string | null | undefined
        stats_synced_at: string | null | undefined
        tenant_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        ig_media_external_id: string | undefined
        youtube_video_id: string | undefined
        status: string | undefined
        error: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        views: number | string | undefined
        likes: number | string | undefined
        comments: number | string | undefined
        stats_synced_at: string | undefined
        tenant_id: string | undefined
      }
    }
  }
}
