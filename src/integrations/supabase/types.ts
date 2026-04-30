export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      bot_suggestions: {
        Row: {
          confidence: number
          contract_id: string
          created_at: string
          est_cost: number
          id: string
          market_id: string
          rationale: string
          resolved_at: string | null
          shares: number
          side: Database["public"]["Enums"]["trade_side"]
          status: Database["public"]["Enums"]["suggestion_status"]
          trade_id: string | null
          user_id: string
        }
        Insert: {
          confidence?: number
          contract_id: string
          created_at?: string
          est_cost: number
          id?: string
          market_id: string
          rationale: string
          resolved_at?: string | null
          shares: number
          side: Database["public"]["Enums"]["trade_side"]
          status?: Database["public"]["Enums"]["suggestion_status"]
          trade_id?: string | null
          user_id: string
        }
        Update: {
          confidence?: number
          contract_id?: string
          created_at?: string
          est_cost?: number
          id?: string
          market_id?: string
          rationale?: string
          resolved_at?: string | null
          shares?: number
          side?: Database["public"]["Enums"]["trade_side"]
          status?: Database["public"]["Enums"]["suggestion_status"]
          trade_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_suggestions_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_suggestions_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_suggestions_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "trades"
            referencedColumns: ["id"]
          },
        ]
      }
      bots: {
        Row: {
          caretaker_mode: Database["public"]["Enums"]["caretaker_mode"]
          created_at: string
          custom_prompt: string | null
          enabled_market_ids: string[]
          max_daily_loss: number
          max_position_size: number
          mode: Database["public"]["Enums"]["bot_mode"]
          strategy: Database["public"]["Enums"]["bot_strategy"]
          updated_at: string
          user_id: string
        }
        Insert: {
          caretaker_mode?: Database["public"]["Enums"]["caretaker_mode"]
          created_at?: string
          custom_prompt?: string | null
          enabled_market_ids?: string[]
          max_daily_loss?: number
          max_position_size?: number
          mode?: Database["public"]["Enums"]["bot_mode"]
          strategy?: Database["public"]["Enums"]["bot_strategy"]
          updated_at?: string
          user_id: string
        }
        Update: {
          caretaker_mode?: Database["public"]["Enums"]["caretaker_mode"]
          created_at?: string
          custom_prompt?: string | null
          enabled_market_ids?: string[]
          max_daily_loss?: number
          max_position_size?: number
          mode?: Database["public"]["Enums"]["bot_mode"]
          strategy?: Database["public"]["Enums"]["bot_strategy"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      caretaker_messages: {
        Row: {
          approved: boolean | null
          content: string | null
          created_at: string
          id: string
          pending_approval: boolean
          result: Json | null
          role: Database["public"]["Enums"]["caretaker_role"]
          tool_call_id: string | null
          tool_calls: Json | null
          user_id: string
        }
        Insert: {
          approved?: boolean | null
          content?: string | null
          created_at?: string
          id?: string
          pending_approval?: boolean
          result?: Json | null
          role: Database["public"]["Enums"]["caretaker_role"]
          tool_call_id?: string | null
          tool_calls?: Json | null
          user_id: string
        }
        Update: {
          approved?: boolean | null
          content?: string | null
          created_at?: string
          id?: string
          pending_approval?: boolean
          result?: Json | null
          role?: Database["public"]["Enums"]["caretaker_role"]
          tool_call_id?: string | null
          tool_calls?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      contracts: {
        Row: {
          created_at: string
          fee_bps: number
          id: string
          kind: Database["public"]["Enums"]["contract_kind"]
          liquidity: number
          market_id: string
          reserve_no: number
          reserve_yes: number
          total_no_outstanding: number
          total_yes_outstanding: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          fee_bps?: number
          id?: string
          kind: Database["public"]["Enums"]["contract_kind"]
          liquidity?: number
          market_id: string
          reserve_no?: number
          reserve_yes?: number
          total_no_outstanding?: number
          total_yes_outstanding?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          fee_bps?: number
          id?: string
          kind?: Database["public"]["Enums"]["contract_kind"]
          liquidity?: number
          market_id?: string
          reserve_no?: number
          reserve_yes?: number
          total_no_outstanding?: number
          total_yes_outstanding?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
        ]
      }
      data_sources: {
        Row: {
          created_at: string
          creator_id: string
          custom_url: string | null
          fetch_interval_minutes: number
          id: string
          json_path: string | null
          kind: Database["public"]["Enums"]["data_source_kind"]
          last_error: string | null
          last_fetched_at: string | null
          provider: string | null
          provider_params: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          creator_id: string
          custom_url?: string | null
          fetch_interval_minutes?: number
          id?: string
          json_path?: string | null
          kind?: Database["public"]["Enums"]["data_source_kind"]
          last_error?: string | null
          last_fetched_at?: string | null
          provider?: string | null
          provider_params?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          creator_id?: string
          custom_url?: string | null
          fetch_interval_minutes?: number
          id?: string
          json_path?: string | null
          kind?: Database["public"]["Enums"]["data_source_kind"]
          last_error?: string | null
          last_fetched_at?: string | null
          provider?: string | null
          provider_params?: Json
          updated_at?: string
        }
        Relationships: []
      }
      ledger_entries: {
        Row: {
          amount: number
          created_at: string
          id: string
          note: string | null
          reason: Database["public"]["Enums"]["ledger_reason"]
          ref_id: string | null
          ref_type: string | null
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          note?: string | null
          reason: Database["public"]["Enums"]["ledger_reason"]
          ref_id?: string | null
          ref_type?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          note?: string | null
          reason?: Database["public"]["Enums"]["ledger_reason"]
          ref_id?: string | null
          ref_type?: string | null
          user_id?: string
        }
        Relationships: []
      }
      market_data_points: {
        Row: {
          created_at: string
          id: string
          market_id: string
          ts: string
          value: number
        }
        Insert: {
          created_at?: string
          id?: string
          market_id: string
          ts: string
          value: number
        }
        Update: {
          created_at?: string
          id?: string
          market_id?: string
          ts?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "market_data_points_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
        ]
      }
      markets: {
        Row: {
          band_is_pct: boolean
          band_width: number
          category: string | null
          created_at: string
          creator_id: string
          data_source_id: string | null
          description: string | null
          final_value: number | null
          id: string
          name: string
          resolution_at: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["market_status"]
          trend_model: Database["public"]["Enums"]["trend_model"]
          trend_params: Json
          unit: string | null
          updated_at: string
        }
        Insert: {
          band_is_pct?: boolean
          band_width?: number
          category?: string | null
          created_at?: string
          creator_id: string
          data_source_id?: string | null
          description?: string | null
          final_value?: number | null
          id?: string
          name: string
          resolution_at: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["market_status"]
          trend_model?: Database["public"]["Enums"]["trend_model"]
          trend_params?: Json
          unit?: string | null
          updated_at?: string
        }
        Update: {
          band_is_pct?: boolean
          band_width?: number
          category?: string | null
          created_at?: string
          creator_id?: string
          data_source_id?: string | null
          description?: string | null
          final_value?: number | null
          id?: string
          name?: string
          resolution_at?: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["market_status"]
          trend_model?: Database["public"]["Enums"]["trend_model"]
          trend_params?: Json
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "markets_data_source_id_fkey"
            columns: ["data_source_id"]
            isOneToOne: false
            referencedRelation: "data_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      positions: {
        Row: {
          contract_id: string
          cost_basis_no: number
          cost_basis_yes: number
          id: string
          no_shares: number
          updated_at: string
          user_id: string
          yes_shares: number
        }
        Insert: {
          contract_id: string
          cost_basis_no?: number
          cost_basis_yes?: number
          id?: string
          no_shares?: number
          updated_at?: string
          user_id: string
          yes_shares?: number
        }
        Update: {
          contract_id?: string
          cost_basis_no?: number
          cost_basis_yes?: number
          id?: string
          no_shares?: number
          updated_at?: string
          user_id?: string
          yes_shares?: number
        }
        Relationships: [
          {
            foreignKeyName: "positions_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      reports: {
        Row: {
          content_md: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["report_kind"]
          metrics: Json
          period_end: string
          period_start: string
          title: string
          user_id: string
        }
        Insert: {
          content_md: string
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["report_kind"]
          metrics?: Json
          period_end: string
          period_start: string
          title: string
          user_id: string
        }
        Update: {
          content_md?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["report_kind"]
          metrics?: Json
          period_end?: string
          period_start?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      trades: {
        Row: {
          by_bot: boolean
          contract_id: string
          cost: number
          created_at: string
          fee: number
          id: string
          price: number
          shares: number
          side: Database["public"]["Enums"]["trade_side"]
          user_id: string
        }
        Insert: {
          by_bot?: boolean
          contract_id: string
          cost: number
          created_at?: string
          fee?: number
          id?: string
          price: number
          shares: number
          side: Database["public"]["Enums"]["trade_side"]
          user_id: string
        }
        Update: {
          by_bot?: boolean
          contract_id?: string
          cost?: number
          created_at?: string
          fee?: number
          id?: string
          price?: number
          shares?: number
          side?: Database["public"]["Enums"]["trade_side"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trades_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      user_goals: {
        Row: {
          created_at: string
          deadline: string | null
          id: string
          max_loss: number | null
          notes: string | null
          status: Database["public"]["Enums"]["goal_status"]
          target_return_pct: number | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deadline?: string | null
          id?: string
          max_loss?: number | null
          notes?: string | null
          status?: Database["public"]["Enums"]["goal_status"]
          target_return_pct?: number | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deadline?: string | null
          id?: string
          max_loss?: number | null
          notes?: string | null
          status?: Database["public"]["Enums"]["goal_status"]
          target_return_pct?: number | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wallets: {
        Row: {
          balance: number
          created_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      execute_trade: {
        Args: {
          _by_bot?: boolean
          _contract_id: string
          _shares: number
          _side: Database["public"]["Enums"]["trade_side"]
        }
        Returns: {
          by_bot: boolean
          contract_id: string
          cost: number
          created_at: string
          fee: number
          id: string
          price: number
          shares: number
          side: Database["public"]["Enums"]["trade_side"]
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "trades"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      pick_top_live_markets: { Args: { _limit?: number }; Returns: string[] }
      resolve_market: {
        Args: { _final_value: number; _market_id: string }
        Returns: {
          band_is_pct: boolean
          band_width: number
          category: string | null
          created_at: string
          creator_id: string
          data_source_id: string | null
          description: string | null
          final_value: number | null
          id: string
          name: string
          resolution_at: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["market_status"]
          trend_model: Database["public"]["Enums"]["trend_model"]
          trend_params: Json
          unit: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "markets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_market_system: {
        Args: { _final_value: number; _market_id: string }
        Returns: {
          band_is_pct: boolean
          band_width: number
          category: string | null
          created_at: string
          creator_id: string
          data_source_id: string | null
          description: string | null
          final_value: number | null
          id: string
          name: string
          resolution_at: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["market_status"]
          trend_model: Database["public"]["Enums"]["trend_model"]
          trend_params: Json
          unit: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "markets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      app_role: "admin" | "user"
      bot_mode: "off" | "suggest" | "approve" | "auto"
      bot_strategy: "mean_reversion" | "momentum" | "custom"
      caretaker_mode: "chat" | "assist" | "autopilot"
      caretaker_role: "system" | "user" | "assistant" | "tool"
      contract_kind: "distortion" | "snapback"
      data_source_kind: "manual" | "provider" | "custom_url"
      goal_status: "active" | "achieved" | "failed" | "cancelled"
      ledger_reason:
        | "signup_bonus"
        | "deposit"
        | "withdrawal"
        | "trade"
        | "settlement"
        | "fee"
        | "bot_action"
        | "adjustment"
      market_status: "open" | "resolving" | "resolved"
      report_kind: "daily" | "weekly" | "monthly" | "on_demand"
      suggestion_status:
        | "pending"
        | "accepted"
        | "rejected"
        | "executed"
        | "expired"
      trade_side: "buy_yes" | "sell_yes" | "buy_no" | "sell_no"
      trend_model:
        | "linear"
        | "moving_avg"
        | "exponential"
        | "log_linear"
        | "seasonal"
        | "bollinger"
        | "ewma"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      bot_mode: ["off", "suggest", "approve", "auto"],
      bot_strategy: ["mean_reversion", "momentum", "custom"],
      caretaker_mode: ["chat", "assist", "autopilot"],
      caretaker_role: ["system", "user", "assistant", "tool"],
      contract_kind: ["distortion", "snapback"],
      data_source_kind: ["manual", "provider", "custom_url"],
      goal_status: ["active", "achieved", "failed", "cancelled"],
      ledger_reason: [
        "signup_bonus",
        "deposit",
        "withdrawal",
        "trade",
        "settlement",
        "fee",
        "bot_action",
        "adjustment",
      ],
      market_status: ["open", "resolving", "resolved"],
      report_kind: ["daily", "weekly", "monthly", "on_demand"],
      suggestion_status: [
        "pending",
        "accepted",
        "rejected",
        "executed",
        "expired",
      ],
      trade_side: ["buy_yes", "sell_yes", "buy_no", "sell_no"],
      trend_model: [
        "linear",
        "moving_avg",
        "exponential",
        "log_linear",
        "seasonal",
        "bollinger",
        "ewma",
      ],
    },
  },
} as const
